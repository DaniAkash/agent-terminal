use super::{number, timestamp};
use crate::usage::types::UsageWindow;
use serde_json::Value;

pub fn parse(json: &Value) -> Vec<UsageWindow> {
    let data = json
        .pointer("/result/data/json")
        .or_else(|| json.pointer("/result/data"))
        .unwrap_or(&Value::Null);
    let subscription = data.get("subscription").unwrap_or(data);
    let used = subscription.get("currentPeriodUsageUsd").and_then(number);
    let base = subscription
        .get("currentPeriodBaseCreditsUsd")
        .and_then(number);
    let bonus = subscription
        .get("currentPeriodBonusCreditsUsd")
        .and_then(number)
        .unwrap_or(0.0)
        .max(0.0);
    let Some((used, total)) = used
        .zip(base.map(|base| base + bonus))
        .filter(|(used, total)| *used >= 0.0 && *total > 0.0)
    else {
        return vec![];
    };
    let reset = ["nextBillingAt", "nextRenewalAt", "renewsAt", "renewAt"]
        .iter()
        .find_map(|key| subscription.get(*key).and_then(timestamp));
    UsageWindow::new("pass", "Kilo Pass", used / total * 100.0, reset)
        .into_iter()
        .collect()
}
