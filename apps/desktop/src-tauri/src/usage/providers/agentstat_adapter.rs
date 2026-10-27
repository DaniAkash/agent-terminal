//! Bridge agentstat's provider data into Jarvis's existing quota contract.
use super::super::credentials::Credential;
use super::super::types::{CollectedUsage, CollectionError, UsageStatus, UsageWindow};
use agentstat::{AccountScope, AgentStatError, FetchRequest, ProviderId, QuotaWindow};
use std::{sync::OnceLock, time::Duration};

fn client() -> Result<&'static agentstat::Client, CollectionError> {
    static CLIENT: OnceLock<Result<agentstat::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            agentstat::Client::builder()
                .http_client_builder(
                    reqwest12::Client::builder()
                        .https_only(true)
                        .connect_timeout(Duration::from_secs(5)),
                )
                .timeout(Duration::from_secs(15))
                .max_response_bytes(super::super::http::MAX_BODY)
                .build()
                .map_err(|_| "Jarvis could not initialize its usage client.".to_string())
        })
        .as_ref()
        .map_err(|message| CollectionError::temporary(message.clone()))
}

pub async fn fetch(id: &str, credential: &Credential) -> Result<CollectedUsage, CollectionError> {
    fetch_with_client(client()?, id, credential).await
}

async fn fetch_with_client(
    client: &agentstat::Client,
    id: &str,
    credential: &Credential,
) -> Result<CollectedUsage, CollectionError> {
    let provider = if id == "codex" {
        ProviderId::Codex
    } else {
        ProviderId::Claude
    };
    let request = FetchRequest::new(provider, agentstat::Credentials::bearer(&credential.token))
        .scope(AccountScope {
            account_id: credential.account.clone(),
            ..Default::default()
        });
    let snapshot = client.fetch(request).await.map_err(map_error)?;
    let windows = normalize(id, &snapshot.windows);
    if windows.is_empty() {
        return Err(CollectionError::malformed());
    }
    Ok(CollectedUsage {
        windows,
        source: credential.source.clone(),
    })
}

fn map_error(error: AgentStatError) -> CollectionError {
    match error {
        AgentStatError::Authentication
        | AgentStatError::PermissionDenied
        | AgentStatError::InvalidCredentials(_) => CollectionError::new(
            UsageStatus::NotConfigured,
            "Usage access was rejected. Sign in again with the provider CLI, then refresh Jarvis.",
        ),
        AgentStatError::RateLimited { .. } => {
            CollectionError::temporary("The provider is rate limiting usage requests. Retry later.")
        }
        AgentStatError::Transport
        | AgentStatError::Timeout
        | AgentStatError::Http { status: 500..=599 } => CollectionError::temporary(
            "Could not reach the provider. Check your connection and retry.",
        ),
        AgentStatError::Unsupported { .. }
        | AgentStatError::UnsupportedSource(_)
        | AgentStatError::FeatureDisabled(_) => CollectionError::new(
            UsageStatus::Unsupported,
            "This provider usage source is unavailable.",
        ),
        _ => CollectionError::malformed(),
    }
}

fn normalize(id: &str, input: &[QuotaWindow]) -> Vec<UsageWindow> {
    let mut result = Vec::new();
    if id == "claude-code" {
        for (key, label) in [
            ("five_hour", "5 hours"),
            ("seven_day", "Weekly"),
            ("seven_day_sonnet", "Sonnet · Weekly"),
            ("seven_day_opus", "Opus · Weekly"),
        ] {
            if let Some(window) = input.iter().find(|w| w.id == key) {
                push(&mut result, window, key, label);
            }
        }
        return result;
    }
    let mut models: Vec<String> = Vec::new();
    for window in input {
        let (base, prefix, model_label) = if window.id == "primary" || window.id == "secondary" {
            (window.id.as_str(), String::new(), String::new())
        } else if (window.id.starts_with("model-") || window.id.starts_with("additional-"))
            && (window.id.ends_with("-primary") || window.id.ends_with("-secondary"))
        {
            let (group, base) = window.id.rsplit_once('-').unwrap();
            let index = match models.iter().position(|name| name == group) {
                Some(index) => index,
                None if models.len() < 16 => {
                    models.push(group.to_string());
                    models.len() - 1
                }
                None => continue,
            };
            (
                base,
                format!("model-{index}-"),
                format!("{} · ", window.model.as_deref().unwrap_or("Model limit")),
            )
        } else {
            continue;
        };
        let (suffix, fallback) = if base == "primary" {
            ("session", "Session")
        } else {
            ("weekly", "Weekly")
        };
        let label = match window.duration_seconds {
            Some(18_000) => "5 hours",
            Some(604_800) => "Weekly",
            Some(2_592_000) => "Monthly",
            _ => fallback,
        };
        push(
            &mut result,
            window,
            &format!("{prefix}{suffix}"),
            &format!("{model_label}{label}"),
        );
    }
    result
}

fn push(result: &mut Vec<UsageWindow>, window: &QuotaWindow, id: &str, label: &str) {
    if let Some(usage) = window.utilization_percent.and_then(|used| {
        UsageWindow::new(
            id,
            label,
            used,
            window.resets_at.map(|date| date.timestamp()),
        )
    }) {
        result.push(usage);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn window(
        id: &str,
        used: Option<f64>,
        duration: Option<u64>,
        model: Option<&str>,
    ) -> QuotaWindow {
        serde_json::from_value(json!({
            "id": id, "model": model, "used": null, "remaining": null,
            "limit": {"kind": "unknown"}, "unit": {"kind": "percent"},
            "utilization_percent": used, "duration_seconds": duration,
            "resets_at": "2027-01-01T00:00:00Z", "kind": "rolling"
        }))
        .unwrap()
    }

    #[test]
    fn maps_codex_windows_and_ignores_balance_only_data() {
        let windows = normalize(
            "codex",
            &[
                window("primary", Some(0.0), Some(18000), None),
                window("model-Spark-primary", Some(91.0), None, Some("Spark")),
                window(
                    "model-Spark-secondary",
                    Some(50.0),
                    Some(604800),
                    Some("Spark"),
                ),
                window("credits", None, None, None),
            ],
        );
        assert_eq!(windows.len(), 3);
        assert_eq!(
            (&*windows[0].id, &*windows[0].label, windows[0].used_percent),
            ("session", "5 hours", 0.0)
        );
        assert_eq!(windows[0].resets_at, Some(1798761600));
        assert_eq!(
            (&*windows[1].id, &*windows[1].label),
            ("model-0-session", "Spark · Session")
        );
        assert_eq!(
            (&*windows[2].id, &*windows[2].label),
            ("model-0-weekly", "Spark · Weekly")
        );
    }

    #[test]
    fn maps_claude_in_stable_order_and_omits_missing_usage() {
        let windows = normalize(
            "claude-code",
            &[
                window("seven_day_sonnet", Some(78.25), Some(604800), None),
                window("seven_day", None, Some(604800), None),
                window("five_hour", Some(0.0), Some(18000), None),
                window("extra-usage", Some(80.0), None, None),
            ],
        );
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].id, "five_hour");
        assert_eq!(windows[1].label, "Sonnet · Weekly");
    }

    #[test]
    fn errors_preserve_retry_and_login_semantics() {
        assert!(map_error(AgentStatError::Timeout).transient);
        assert!(map_error(AgentStatError::RateLimited { retry_after: None }).transient);
        assert_eq!(
            map_error(AgentStatError::Authentication).status,
            UsageStatus::NotConfigured
        );
        assert!(!map_error(AgentStatError::InvalidResponse("fixture")).transient);
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use futures_util::future::BoxFuture;
    use std::sync::{Arc, Mutex};

    #[derive(Debug)]
    struct Fixture {
        body: &'static str,
        status: u16,
        requests: Mutex<Vec<reqwest12::Request>>,
    }
    impl agentstat::HttpExecutor for Fixture {
        fn execute(
            &self,
            request: reqwest12::Request,
        ) -> BoxFuture<'_, agentstat::Result<agentstat::HttpResponse>> {
            self.requests.lock().unwrap().push(request);
            Box::pin(async move {
                Ok(agentstat::HttpResponse {
                    status: self.status,
                    headers: Default::default(),
                    body: self.body.as_bytes().to_vec(),
                })
            })
        }
    }
    fn credential() -> Credential {
        Credential {
            token: "test-token".into(),
            account: Some("account-1".into()),
            source: "fixture".into(),
            headers: vec![],
        }
    }
    #[tokio::test]
    async fn codex_fetch_uses_account_and_normalizes_provider_response() {
        let fixture = Arc::new(Fixture {
            body: r#"{"rate_limit":{"primary_window":{"used_percent":12.5,"reset_at":1800000000,"limit_window_seconds":18000}},"additional_rate_limits":[{"limit_name":"Spark","rate_limit":{"primary_window":{"used_percent":91}}}]}"#,
            status: 200,
            requests: Mutex::new(vec![]),
        });
        let client = agentstat::Client::builder()
            .http_executor(fixture.clone())
            .build()
            .unwrap();
        let result = fetch_with_client(&client, "codex", &credential())
            .await
            .unwrap();
        assert_eq!(result.windows.len(), 2);
        assert_eq!(result.windows[0].label, "5 hours");
        assert_eq!(result.windows[1].label, "Spark · Session");
        let requests = fixture.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].headers()["chatgpt-account-id"], "account-1");
        assert_eq!(requests[0].headers()["authorization"], "Bearer test-token");
        assert_eq!(requests[0].url().host_str(), Some("chatgpt.com"));
    }
    #[tokio::test]
    async fn claude_fetch_maps_missing_windows_and_auth_errors() {
        let fixture = Arc::new(Fixture {
            body: r#"{"five_hour":{"utilization":0,"resets_at":"2027-01-01T00:00:00Z"},"seven_day_sonnet":{"utilization":78.25}}"#,
            status: 200,
            requests: Mutex::new(vec![]),
        });
        let client = agentstat::Client::builder()
            .http_executor(fixture.clone())
            .build()
            .unwrap();
        let mut auth = credential();
        auth.account = None;
        let result = fetch_with_client(&client, "claude-code", &auth)
            .await
            .unwrap();
        assert_eq!(result.windows.len(), 2);
        assert_eq!(result.windows[0].used_percent, 0.0);
        assert_eq!(result.windows[1].resets_at, None);
        assert_eq!(
            fixture.requests.lock().unwrap()[0].headers()["anthropic-beta"],
            "oauth-2025-04-20"
        );
        let denied = Arc::new(Fixture {
            body: "{}",
            status: 401,
            requests: Mutex::new(vec![]),
        });
        let client = agentstat::Client::builder()
            .http_executor(denied)
            .build()
            .unwrap();
        assert_eq!(
            fetch_with_client(&client, "claude-code", &auth)
                .await
                .err()
                .unwrap()
                .status,
            UsageStatus::NotConfigured
        );
    }
    #[tokio::test]
    async fn codex_rejects_mismatched_account_and_marks_rate_limits_transient() {
        for (body, status, expected_transient) in [
            (
                r#"{"account_id":"another-account","rate_limit":{"primary_window":{"used_percent":12}}}"#,
                200,
                false,
            ),
            ("{}", 429, true),
        ] {
            let fixture = Arc::new(Fixture {
                body,
                status,
                requests: Mutex::new(vec![]),
            });
            let client = agentstat::Client::builder()
                .http_executor(fixture)
                .build()
                .unwrap();
            let error = fetch_with_client(&client, "codex", &credential())
                .await
                .err()
                .unwrap();
            assert_eq!(error.status, UsageStatus::Error);
            assert_eq!(error.transient, expected_transient);
        }
    }
}
