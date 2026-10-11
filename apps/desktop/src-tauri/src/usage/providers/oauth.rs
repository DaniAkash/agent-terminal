use super::{number, timestamp};
use crate::usage::types::UsageWindow;
use serde_json::Value;

pub fn codex(json: &Value) -> Vec<UsageWindow> {
    let mut windows = Vec::new();
    add_codex(&mut windows, &json["rate_limit"], "", "");
    if let Some(extra) = json.get("additional_rate_limits").and_then(Value::as_array) {
        for (index, limit) in extra.iter().take(16).enumerate() {
            let label = limit
                .get("limit_name")
                .or_else(|| limit.get("metered_feature"))
                .and_then(Value::as_str)
                .unwrap_or("Model limit");
            add_codex(
                &mut windows,
                &limit["rate_limit"],
                &format!("model-{index}-"),
                &format!("{label} · "),
            );
        }
    }
    windows
}

fn add_codex(windows: &mut Vec<UsageWindow>, limits: &Value, prefix: &str, label_prefix: &str) {
    for (key, id, label) in [
        ("primary_window", "session", "Session"),
        ("secondary_window", "weekly", "Weekly"),
    ] {
        let detail = &limits[key];
        let Some(used) = detail.get("used_percent").and_then(number) else {
            continue;
        };
        let reset = detail.get("reset_at").and_then(timestamp);
        let label = match detail.get("limit_window_seconds").and_then(Value::as_u64) {
            Some(18_000) => "5 hours",
            Some(604_800) => "Weekly",
            Some(2_592_000) => "Monthly",
            _ => label,
        };
        if let Some(window) = UsageWindow::new(
            &format!("{prefix}{id}"),
            &format!("{label_prefix}{label}"),
            used,
            reset,
        ) {
            windows.push(window);
        }
    }
}

pub fn claude(json: &Value) -> Vec<UsageWindow> {
    let mut windows = Vec::new();
    for (id, label) in [
        ("five_hour", "5 hours"),
        ("seven_day", "Weekly"),
        ("seven_day_sonnet", "Sonnet · Weekly"),
        ("seven_day_opus", "Opus · Weekly"),
    ] {
        let detail = &json[id];
        let Some(used) = detail.get("utilization").and_then(number) else {
            continue;
        };
        if let Some(window) =
            UsageWindow::new(id, label, used, detail.get("resets_at").and_then(timestamp))
        {
            windows.push(window);
        }
    }
    windows
}
