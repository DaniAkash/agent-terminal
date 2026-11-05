//! Expo push transport.
//!
//! One POST to `exp.host`, which relays to FCM on Android and APNs on
//! iOS. No new dependency: `reqwest` with `json` and rustls was already
//! in `Cargo.toml` for the updater.
//!
//! Expo is a relay rather than a backend. Nothing is stored there, the
//! desktop holds all the state, and swapping this file for a
//! self-hosted relay later changes nothing above it.

use std::fmt;

use serde::{Deserialize, Serialize};

use super::escalation::{DevicePrefs, Pending};

const ENDPOINT: &str = "https://exp.host/--/api/v2/push/send";

/// Ten minutes. A buzz about an agent that needed attention an hour ago
/// is noise, so FCM and APNs are told to drop it rather than deliver it
/// late. Matches `STALE_AFTER_DUE` on purpose: the two ends of the same
/// policy.
const TTL_SECONDS: u32 = 600;

#[derive(Debug, Serialize)]
pub struct ExpoMessage {
    pub to: String,
    pub title: String,
    pub body: String,
    pub data: serde_json::Value,
    pub ttl: u32,
    pub priority: &'static str,
    /// Coalesces in transit. Keyed by tab, so a chatty tab replaces its
    /// own earlier notification instead of stacking six of them.
    #[serde(rename = "collapseId")]
    pub collapse_id: String,
    /// Android: replaces an already displayed notification with the same
    /// tag. The displayed-side partner to `collapseId`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// Android: picks the channel, and therefore the importance and
    /// sound the user has control over. A message naming a channel the
    /// device does not have is not displayed at all.
    #[serde(rename = "channelId", skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    /// iOS: visual grouping.
    #[serde(rename = "threadId", skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    /// iOS: lets a blocked agent break through Focus. Requires the Time
    /// Sensitive Notifications capability on the App ID.
    #[serde(rename = "interruptionLevel", skip_serializing_if = "Option::is_none")]
    pub interruption_level: Option<&'static str>,
}

pub fn channel_for(state: &str) -> &'static str {
    match state {
        "awaiting" => "agent-awaiting",
        "error" => "agent-error",
        _ => "agent-completed",
    }
}

pub fn build_message(
    token: &str,
    pending: &Pending,
    device: &DevicePrefs,
    title: &str,
    body: &str,
    state: &str,
    signature: &str,
) -> ExpoMessage {
    let key = format!("tab:{}", pending.composite_tab_id);
    let ios = device.is_ios();
    let high = matches!(state, "awaiting" | "error");

    ExpoMessage {
        to: token.to_string(),
        title: title.to_string(),
        body: body.to_string(),
        // Routing payload: opaque ids only, so it stays safe to send
        // even with redaction on, and the phone never has to parse
        // display text to decide where to go. `v` lets an older phone
        // refuse a future shape rather than mis-route it.
        data: serde_json::json!({
            "v": super::sign::PAYLOAD_VERSION,
            "deviceId": device.device_id,
            "projectId": pending.project_id,
            "tabId": pending.tab_id_in_project,
            "state": state,
            "agentId": pending.agent_id,
            "firedAt": pending.fired_at_wall,
            "sig": signature,
        }),
        ttl: TTL_SECONDS,
        priority: if high { "high" } else { "normal" },
        collapse_id: key.clone(),
        tag: (!ios).then(|| key.clone()),
        channel_id: (!ios).then(|| channel_for(state).to_string()),
        thread_id: ios.then(|| key.clone()),
        interruption_level: (ios && state == "awaiting").then_some("time-sensitive"),
    }
}

#[derive(Debug)]
pub enum SendError {
    /// Clear the stored token. The phone re-registers on its next
    /// connect, so this self-heals.
    DeviceNotRegistered,
    /// Misconfiguration rather than a transient fault. Stop retrying and
    /// surface it to the phone, which is the only place a human looks.
    Credentials(String),
    RateLimited,
    Transport(String),
    /// Unexpected shape. Logged once so a future Expo error code is
    /// visible rather than swallowed.
    Protocol(String),
}

impl fmt::Display for SendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DeviceNotRegistered => write!(f, "device not registered"),
            Self::Credentials(e) => write!(f, "push credentials rejected: {e}"),
            Self::RateLimited => write!(f, "rate limited by Expo"),
            Self::Transport(e) => write!(f, "transport error: {e}"),
            Self::Protocol(e) => write!(f, "unexpected response: {e}"),
        }
    }
}

#[derive(Debug, Deserialize)]
struct TicketEnvelope {
    #[serde(default)]
    data: Option<Ticket>,
    #[serde(default)]
    errors: Option<Vec<RequestError>>,
}

#[derive(Debug, Deserialize)]
struct Ticket {
    status: String,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    details: Option<TicketDetails>,
}

#[derive(Debug, Deserialize)]
struct TicketDetails {
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RequestError {
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

pub async fn send(client: &reqwest::Client, msg: &ExpoMessage) -> Result<(), SendError> {
    let resp = client
        .post(ENDPOINT)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .json(msg)
        .send()
        .await
        .map_err(|e| SendError::Transport(e.to_string()))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| SendError::Transport(e.to_string()))?;

    if status.as_u16() == 429 {
        return Err(SendError::RateLimited);
    }
    classify(&text)
}

/// Split from `send` so the whole response-handling matrix is testable
/// without a network.
pub fn classify(body: &str) -> Result<(), SendError> {
    let env: TicketEnvelope =
        serde_json::from_str(body).map_err(|e| SendError::Protocol(e.to_string()))?;

    if let Some(errors) = env.errors.as_ref().filter(|e| !e.is_empty()) {
        let first = &errors[0];
        let code = first.code.clone().unwrap_or_default();
        let message = first.message.clone().unwrap_or_default();
        return Err(match code.as_str() {
            "TOO_MANY_REQUESTS" => SendError::RateLimited,
            "UNAUTHORIZED" => SendError::Credentials(message),
            _ => SendError::Protocol(format!("{code}: {message}")),
        });
    }

    let Some(ticket) = env.data else {
        return Err(SendError::Protocol("no ticket in response".to_string()));
    };
    if ticket.status == "ok" {
        return Ok(());
    }
    let detail = ticket
        .details
        .and_then(|d| d.error)
        .unwrap_or_else(|| "unknown".to_string());
    let message = ticket.message.unwrap_or_default();
    Err(match detail.as_str() {
        "DeviceNotRegistered" => SendError::DeviceNotRegistered,
        "MessageRateExceeded" => SendError::RateLimited,
        "MismatchSenderId" | "InvalidCredentials" => SendError::Credentials(message),
        other => SendError::Protocol(format!("{other}: {message}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notifications::AgentNotifyState;
    use std::collections::HashSet;
    use std::time::{Duration, Instant};

    fn pending() -> Pending {
        Pending {
            composite_tab_id: "proj_01HQ:tab_04".into(),
            project_id: "proj_01HQ".into(),
            tab_id_in_project: "tab_04".into(),
            agent_id: "claude-code".into(),
            state: AgentNotifyState::Awaiting,
            title: "Claude Code · control-center".into(),
            body: "Allow edit?".into(),
            fired_at: Instant::now(),
            fired_at_wall: 1_762_338_240_000,
            wake_grace: Duration::ZERO,
            remaining: HashSet::new(),
        }
    }

    fn device(platform: &str) -> DevicePrefs {
        DevicePrefs {
            device_id: "e7a1c3f0-2b44-4d19-9c7e-5f0a8b61d204".into(),
            token: Some("ExponentPushToken[abc]".into()),
            token_hash: "a".repeat(64),
            platform: platform.into(),
            delay: Duration::from_secs(180),
            redact_names: false,
        }
    }

    /// Cross-language fixture: the companion has a matching test that
    /// parses exactly this `data` object. `data` is free-form JSON, so
    /// the typeshare drift check cannot see it and this pair is the only
    /// thing keeping the two sides honest.
    #[test]
    fn the_data_payload_matches_the_shared_fixture() {
        let m = build_message(
            "ExponentPushToken[abc]",
            &pending(),
            &device("ios"),
            "Claude Code · control-center",
            "Allow edit?",
            "awaiting",
            "e26e2e3eabfcdba29c4ccd0a344c037c",
        );
        assert_eq!(
            m.data,
            serde_json::json!({
                "v": 1,
                "deviceId": "e7a1c3f0-2b44-4d19-9c7e-5f0a8b61d204",
                "projectId": "proj_01HQ",
                "tabId": "tab_04",
                "state": "awaiting",
                "agentId": "claude-code",
                "firedAt": 1_762_338_240_000i64,
                "sig": "e26e2e3eabfcdba29c4ccd0a344c037c",
            })
        );
    }

    #[test]
    fn android_gets_a_channel_and_a_tag_but_no_ios_fields() {
        let m = build_message("t", &pending(), &device("android"), "t", "b", "awaiting", "s");
        assert_eq!(m.channel_id.as_deref(), Some("agent-awaiting"));
        assert_eq!(m.tag.as_deref(), Some("tab:proj_01HQ:tab_04"));
        assert!(m.thread_id.is_none());
        assert!(m.interruption_level.is_none());
    }

    #[test]
    fn ios_gets_a_thread_and_time_sensitive_but_no_channel() {
        let m = build_message("t", &pending(), &device("ios"), "t", "b", "awaiting", "s");
        assert!(m.channel_id.is_none());
        assert!(m.tag.is_none());
        assert_eq!(m.thread_id.as_deref(), Some("tab:proj_01HQ:tab_04"));
        assert_eq!(m.interruption_level, Some("time-sensitive"));
    }

    #[test]
    fn only_awaiting_is_time_sensitive() {
        let m = build_message("t", &pending(), &device("ios"), "t", "b", "completed", "s");
        assert!(m.interruption_level.is_none());
        assert_eq!(m.priority, "normal");
    }

    #[test]
    fn awaiting_and_error_are_high_priority() {
        for s in ["awaiting", "error"] {
            let m = build_message("t", &pending(), &device("ios"), "t", "b", s, "s");
            assert_eq!(m.priority, "high", "{s}");
        }
    }

    #[test]
    fn the_collapse_key_is_the_tab_so_one_tab_never_stacks() {
        let m = build_message("t", &pending(), &device("ios"), "t", "b", "awaiting", "s");
        assert_eq!(m.collapse_id, "tab:proj_01HQ:tab_04");
    }

    #[test]
    fn channels_map_one_per_state() {
        assert_eq!(channel_for("awaiting"), "agent-awaiting");
        assert_eq!(channel_for("error"), "agent-error");
        assert_eq!(channel_for("completed"), "agent-completed");
    }

    #[test]
    fn ttl_keeps_a_late_push_from_arriving_at_all() {
        let m = build_message("t", &pending(), &device("ios"), "t", "b", "awaiting", "s");
        assert_eq!(m.ttl, 600);
    }

    #[test]
    fn an_ok_ticket_succeeds() {
        assert!(classify(r#"{"data":{"status":"ok","id":"x"}}"#).is_ok());
    }

    #[test]
    fn device_not_registered_is_recognised() {
        let e = classify(
            r#"{"data":{"status":"error","message":"gone","details":{"error":"DeviceNotRegistered"}}}"#,
        )
        .unwrap_err();
        assert!(matches!(e, SendError::DeviceNotRegistered));
    }

    #[test]
    fn credentials_errors_are_recognised() {
        for code in ["MismatchSenderId", "InvalidCredentials"] {
            let body = format!(
                r#"{{"data":{{"status":"error","message":"bad","details":{{"error":"{code}"}}}}}}"#
            );
            assert!(matches!(
                classify(&body).unwrap_err(),
                SendError::Credentials(_)
            ));
        }
    }

    #[test]
    fn rate_limits_are_recognised_from_both_shapes() {
        assert!(matches!(
            classify(r#"{"data":{"status":"error","details":{"error":"MessageRateExceeded"}}}"#)
                .unwrap_err(),
            SendError::RateLimited
        ));
        assert!(matches!(
            classify(r#"{"errors":[{"code":"TOO_MANY_REQUESTS","message":"slow down"}]}"#)
                .unwrap_err(),
            SendError::RateLimited
        ));
    }

    #[test]
    fn an_unknown_error_code_surfaces_rather_than_being_swallowed() {
        let e = classify(
            r#"{"data":{"status":"error","message":"m","details":{"error":"SomethingNew"}}}"#,
        )
        .unwrap_err();
        match e {
            SendError::Protocol(s) => assert!(s.contains("SomethingNew")),
            other => panic!("expected Protocol, got {other:?}"),
        }
    }

    #[test]
    fn garbage_is_a_protocol_error_not_a_panic() {
        assert!(matches!(
            classify("not json").unwrap_err(),
            SendError::Protocol(_)
        ));
    }
}
