//! Usage adapters have their own capabilities, independently of PTY hook support.
mod amp;
mod kilo;
mod kimi;
mod oauth;
mod opencode;

use super::types::{CollectedUsage, CollectionError, UsageStatus, UsageWindow};
use super::{credentials, http};
use reqwest::Client;
use serde_json::Value;
use std::path::PathBuf;

pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
}

pub const PROVIDERS: &[Provider] = &[
    Provider {
        id: "codex",
        name: "Codex",
    },
    Provider {
        id: "claude-code",
        name: "Claude Code",
    },
    Provider {
        id: "opencode",
        name: "OpenCode",
    },
    Provider {
        id: "amp",
        name: "Amp",
    },
    Provider {
        id: "kilo",
        name: "Kilo",
    },
    Provider {
        id: "kimi",
        name: "Kimi",
    },
    Provider {
        id: "mastracode",
        name: "Mastra",
    },
];

/// Resolve the same installation paths used by automatic agent discovery.
pub fn amp_binary() -> Option<PathBuf> {
    super::discovery::binary("amp")
}

pub struct Outcome {
    pub owner: Option<String>,
    pub result: Result<CollectedUsage, CollectionError>,
}

pub async fn collect(provider: &'static Provider, client: &Client) -> Outcome {
    if provider.id == "mastracode" {
        return Outcome { owner: None, result: Err(CollectionError::new(
            UsageStatus::Unsupported, "Mastra uses your configured model provider. A shared Mastra quota source is not available.")) };
    }
    if provider.id == "amp" {
        return amp::collect().await;
    }
    if provider.id == "opencode" {
        return opencode::collect(client).await;
    }
    let id = provider.id;
    let resolved = tokio::task::spawn_blocking(move || credentials::resolve(id)).await;
    let credential = match resolved {
        Ok(Ok(c)) => c,
        Ok(Err(e)) => {
            return Outcome {
                owner: None,
                result: Err(e),
            }
        }
        Err(_) => {
            return Outcome {
                owner: None,
                result: Err(CollectionError::temporary(
                    "Could not read the provider session.",
                )),
            }
        }
    };
    let owner = credential.fingerprint();
    let result = fetch(id, client, &credential).await;
    // A login/account change while HTTP was in flight invalidates that reading.
    let current =
        tokio::task::spawn_blocking(move || credentials::resolve(id).map(|c| c.fingerprint()))
            .await;
    if !matches!(current, Ok(Ok(ref fingerprint)) if fingerprint == &owner) {
        return Outcome {
            owner: None,
            result: Err(credentials::missing(
                "The provider session changed. Refresh to read the current account.",
            )),
        };
    }
    Outcome {
        owner: Some(owner),
        result,
    }
}

async fn fetch(
    id: &str,
    client: &Client,
    credential: &credentials::Credential,
) -> Result<CollectedUsage, CollectionError> {
    let url = match id {
        "codex" => "https://chatgpt.com/backend-api/wham/usage",
        "claude-code" => "https://api.anthropic.com/api/oauth/usage",
        "opencode" => "https://opencode.ai/zen/go/v1/usage",
        "kilo" => "https://app.kilo.ai/api/trpc/kiloPass.getState",
        "kimi" => "https://api.kimi.com/coding/v1/usages",
        _ => return Err(CollectionError::malformed()),
    };
    let mut request = client
        .get(url)
        .bearer_auth(&credential.token)
        .header("Accept", "application/json");
    if id == "codex" {
        if let Some(account) = &credential.account {
            request = request.header("ChatGPT-Account-Id", account);
        }
    }
    if id == "claude-code" {
        request = request.header("anthropic-beta", "oauth-2025-04-20");
    }
    if id == "kilo" {
        request = request.query(&[("input", r#"{"json":null}"#)]);
    }
    for (name, value) in &credential.headers {
        request = request.header(name, value);
    }
    let json = http::json(request).await?;
    let windows = match id {
        "codex" => oauth::codex(&json),
        "claude-code" => oauth::claude(&json),
        "opencode" => opencode::parse(&json),
        "kilo" => kilo::parse(&json),
        "kimi" => kimi::parse(&json),
        _ => vec![],
    };
    if windows.is_empty() {
        if id == "kilo"
            && json
                .pointer("/result/data/json/subscription")
                .is_some_and(Value::is_null)
        {
            return Err(CollectionError::new(UsageStatus::Unsupported, "This Kilo account has no Kilo Pass quota. Pay-as-you-go credit balance is not a quota."));
        }
        return Err(CollectionError::malformed());
    }
    Ok(CollectedUsage {
        windows,
        source: credential.source.clone(),
    })
}

pub fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|n| n.is_finite())
}

pub fn timestamp(value: &Value) -> Option<i64> {
    if let Some(s) = value.as_str() {
        if let Ok(date) = chrono::DateTime::parse_from_rfc3339(s) {
            return Some(date.timestamp());
        }
    }
    number(value)
        .filter(|n| *n > 0.0 && *n < i64::MAX as f64)
        .map(|n| {
            if n > 1_000_000_000_000.0 {
                (n / 1000.0) as i64
            } else {
                n as i64
            }
        })
}

pub fn ratio_window(id: &str, label: &str, detail: &Value) -> Option<UsageWindow> {
    let limit = detail.get("limit").and_then(number).filter(|n| *n > 0.0)?;
    let used = detail.get("used").and_then(number).or_else(|| {
        detail
            .get("remaining")
            .and_then(number)
            .map(|remaining| limit - remaining)
    })?;
    let reset = ["resetTime", "reset_time", "resetAt", "reset_at"]
        .iter()
        .find_map(|key| detail.get(*key).and_then(timestamp));
    UsageWindow::new(id, label, used / limit * 100.0, reset)
}

#[cfg(test)]
pub(crate) use {
    amp::parse as parse_amp,
    kilo::parse as parse_kilo,
    kimi::parse as parse_kimi,
    oauth::{claude as parse_claude, codex as parse_codex},
    opencode::parse as parse_opencode,
};
