use super::Outcome;
use super::{number, timestamp};
use crate::usage::types::{now, UsageWindow};
use crate::usage::types::{CollectedUsage, CollectionError, UsageStatus};
use crate::usage::{credentials, http};
use serde_json::Value;

pub async fn collect(client: &reqwest::Client) -> Outcome {
    let candidates = match tokio::task::spawn_blocking(credentials::opencode_candidates).await {
        Ok(Ok(candidates)) => candidates,
        Ok(Err(error)) => {
            return Outcome {
                owner: None,
                result: Err(error),
            }
        }
        Err(_) => {
            return Outcome {
                owner: None,
                result: Err(CollectionError::temporary(
                    "Could not read the OpenCode session.",
                )),
            }
        }
    };
    let mut rejected = credentials::missing("Connect OpenCode Go in OpenCode, then refresh.");
    for credential in candidates {
        let owner = credential.fingerprint();
        let result = http::opencode_json(
            client
                .get("https://opencode.ai/zen/go/v1/usage")
                .bearer_auth(&credential.token)
                .header("Accept", "application/json"),
        )
        .await
        .and_then(|json| {
            let windows = parse(&json);
            if windows.is_empty() {
                return Err(CollectionError::malformed());
            }
            Ok(CollectedUsage {
                windows,
                source: credential.source,
            })
        });
        if let Err(error) = &result {
            if matches!(
                error.status,
                UsageStatus::NotConfigured | UsageStatus::Unsupported
            ) {
                // An authenticated key without quota is more informative than
                // an expired alternate key. Neither is a transient failure.
                if rejected.status != UsageStatus::Unsupported {
                    rejected = error.clone();
                }
                continue;
            }
        }
        let current = tokio::task::spawn_blocking(credentials::opencode_candidates).await;
        if !matches!(current, Ok(Ok(ref keys)) if keys.iter().any(|key| key.fingerprint() == owner))
        {
            return Outcome {
                owner: None,
                result: Err(credentials::missing(
                    "The OpenCode session changed. Refresh to read the current account.",
                )),
            };
        }
        return Outcome {
            owner: Some(owner),
            result,
        };
    }
    Outcome {
        owner: None,
        result: Err(rejected),
    }
}

pub fn parse(json: &Value) -> Vec<UsageWindow> {
    [
        ("rolling", "5 hours"),
        ("weekly", "Weekly"),
        ("monthly", "Monthly"),
    ]
    .into_iter()
    .filter_map(|(id, label)| {
        let detail = json.get("usage")?.get(id)?;
        // The public API always uses percentage units, including 0.5 = 0.5%.
        let used = detail.get("percent").and_then(number)?;
        let reset = ["resetAt", "resetsAt", "reset_at"]
            .iter()
            .find_map(|key| detail.get(*key).and_then(timestamp))
            .or_else(|| {
                detail
                    .get("resetInSec")
                    .and_then(Value::as_i64)
                    .filter(|n| *n >= 0)
                    .and_then(|n| now().checked_add(n))
            });
        UsageWindow::new(id, label, used, reset)
    })
    .collect()
}
