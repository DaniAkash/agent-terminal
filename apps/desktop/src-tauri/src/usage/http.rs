use super::types::{CollectionError, UsageStatus};
use reqwest::{Client, RequestBuilder};
use serde_json::Value;
use std::time::Duration;

pub const MAX_BODY: usize = 2 * 1024 * 1024;

pub fn client() -> Result<Client, String> {
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("AgentTerminal-Jarvis/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Jarvis could not initialize its HTTPS client.".into())
}

pub async fn json(request: RequestBuilder) -> Result<Value, CollectionError> {
    read_json(request, false).await
}

pub async fn opencode_json(request: RequestBuilder) -> Result<Value, CollectionError> {
    read_json(request, true).await
}

async fn read_json(request: RequestBuilder, opencode: bool) -> Result<Value, CollectionError> {
    let mut response = request.send().await.map_err(|_| {
        CollectionError::temporary("Could not reach the provider. Check your connection and retry.")
    })?;
    let status = response.status().as_u16();
    match status {
        200..=299 => {}
        403 if opencode => {} // Classify the bounded structured body below.
        401 | 403 => return Err(CollectionError::new(
            UsageStatus::NotConfigured,
            "Usage access was rejected. Sign in again with the provider CLI, then refresh Jarvis.",
        )),
        429 => {
            return Err(CollectionError::temporary(
                "The provider is rate limiting usage requests. Retry later.",
            ))
        }
        500..=599 => {
            return Err(CollectionError::temporary(
                "The provider usage service is temporarily unavailable.",
            ))
        }
        _ => {
            return Err(CollectionError::new(
                UsageStatus::Error,
                "The provider usage endpoint did not accept this request.",
            ))
        }
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BODY as u64)
    {
        return Err(CollectionError::malformed());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        CollectionError::temporary("The usage response was interrupted. Retry later.")
    })? {
        if bytes.len() + chunk.len() > MAX_BODY {
            return Err(CollectionError::malformed());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = serde_json::from_slice(&bytes).map_err(|_| CollectionError::malformed())?;
    classify_json(status, opencode, body)
}

pub(super) fn classify_json(
    status: u16,
    opencode: bool,
    body: Value,
) -> Result<Value, CollectionError> {
    if opencode && status == 403 {
        if body.pointer("/error/type").and_then(Value::as_str) == Some("EntitlementError") {
            return Err(CollectionError::new(UsageStatus::Unsupported,
                "This OpenCode key has no Go subscription quota. Zen pay-as-you-go credits do not have weekly or hourly limits. Connect an active OpenCode Go key and refresh."));
        }
        return Err(CollectionError::new(UsageStatus::Error,
            "The OpenCode key lacks permission to read usage. Check the key's workspace and access."));
    }
    Ok(body)
}
