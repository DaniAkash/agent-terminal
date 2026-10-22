use super::{number, ratio_window, timestamp};
use crate::usage::types::UsageWindow;
use serde_json::Value;

pub fn parse(json: &Value) -> Vec<UsageWindow> {
    let mut windows = Vec::new();
    for (id, label) in [
        ("limit_5h", "5 hours"),
        ("limit_7d", "Weekly"),
        ("limit_month_total", "Monthly"),
    ] {
        let detail = &json["usages"][id];
        if let Some(ratio) = detail.get("used_ratio").and_then(number) {
            if let Some(window) = UsageWindow::new(
                id,
                label,
                ratio * 100.0,
                detail.get("reset_time").and_then(timestamp),
            ) {
                windows.push(window);
            }
        }
    }
    if !windows.iter().any(|w| w.id == "limit_7d") {
        if let Some(window) = ratio_window("limit_7d", "Weekly", &json["usage"]) {
            windows.push(window);
        }
    }
    if !windows.iter().any(|w| w.id == "limit_5h") {
        if let Some(limits) = json.get("limits").and_then(Value::as_array) {
            for limit in limits.iter().take(16) {
                let duration = limit.pointer("/window/duration").and_then(number);
                let unit = limit.pointer("/window/timeUnit").and_then(Value::as_str);
                if duration == Some(300.0) && unit == Some("TIME_UNIT_MINUTE") {
                    if let Some(window) = ratio_window("limit_5h", "5 hours", &limit["detail"]) {
                        windows.push(window);
                        break;
                    }
                }
            }
        }
    }
    windows
}
