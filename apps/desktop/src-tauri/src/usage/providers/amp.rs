use super::{amp_binary, Outcome};
use crate::usage::types::{CollectedUsage, CollectionError, UsageStatus, UsageWindow};
use regex::Regex;
use std::{process::Stdio, sync::OnceLock, time::Duration};
use tokio::io::AsyncReadExt;

pub async fn collect() -> Outcome {
    let binary = tokio::task::spawn_blocking(amp_binary).await.ok().flatten();
    let Some(binary) = binary else {
        return Outcome {
            owner: None,
            result: Err(CollectionError::new(
                UsageStatus::NotConfigured,
                "Install Amp and sign in, then refresh Jarvis.",
            )),
        };
    };
    let result = tokio::time::timeout(Duration::from_secs(15), async {
        let mut child = tokio::process::Command::new(binary).arg("usage")
            .current_dir(std::env::temp_dir()).env("NO_COLOR", "1")
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true)
            .spawn().map_err(|_| CollectionError::new(UsageStatus::Error, "Could not run amp usage."))?;
        let stdout = child.stdout.take().ok_or_else(CollectionError::malformed)?;
        let mut bytes = Vec::new();
        stdout.take(65_537).read_to_end(&mut bytes).await
            .map_err(|_| CollectionError::temporary("Amp usage output was interrupted."))?;
        if bytes.len() > 65_536 { return Err(CollectionError::malformed()); }
        let status = child.wait().await.map_err(|_| CollectionError::temporary("Amp usage did not finish."))?;
        if !status.success() {
            return Err(CollectionError::new(UsageStatus::NotConfigured, "Amp usage failed. Open amp, sign in, and refresh Jarvis."));
        }
        let text = String::from_utf8(bytes).map_err(|_| CollectionError::malformed())?;
        let windows = parse(&text);
        if windows.is_empty() {
            return Err(CollectionError::new(UsageStatus::Unsupported, "Amp did not report a supported quota window. Credit-only accounts have no quota meter."));
        }
        // No stale retention for CLI data: there is no independently verifiable owner.
        Ok(CollectedUsage { windows, source: "Amp CLI usage".into() })
    }).await.unwrap_or_else(|_| Err(CollectionError::temporary("Amp usage timed out. Try refreshing later.")));
    Outcome {
        owner: None,
        result,
    }
}

pub fn parse(text: &str) -> Vec<UsageWindow> {
    static ANSI: OnceLock<Regex> = OnceLock::new();
    let ansi = ANSI.get_or_init(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").expect("constant regex"));
    let text = ansi.replace_all(text, "").replace("**", "");
    let mut windows = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with("Amp Free:") {
            parse_free(line, &mut windows);
        } else if line.starts_with("Amp ") && line.contains(" Tier:") {
            parse_tier(line, &mut windows);
        } else if line.starts_with("Subscription ")
            || (line.starts_with("Amp ") && line.contains(" Subscription:"))
        {
            parse_subscription(line, &mut windows);
        }
    }
    windows
}

fn capture(pattern: &str, text: &str) -> Option<Vec<f64>> {
    let regex = Regex::new(pattern).ok()?;
    let captures = regex.captures(text)?;
    captures
        .iter()
        .skip(1)
        .map(|c| c?.as_str().replace(',', "").parse::<f64>().ok())
        .collect::<Option<Vec<_>>>()
}

fn push(windows: &mut Vec<UsageWindow>, id: &str, label: &str, used: f64) {
    if windows.iter().any(|w| w.id == id) {
        return;
    }
    if let Some(window) = UsageWindow::new(id, label, used, None) {
        windows.push(window);
    }
}

fn parse_free(line: &str, windows: &mut Vec<UsageWindow>) {
    if let Some(values) = capture(r"^Amp Free:\s*([0-9,.]+)\s*%\s+remaining", line) {
        push(windows, "free", "Daily free", 100.0 - values[0]);
    } else if let Some(values) = capture(
        r"^Amp Free:\s*\$?([0-9,.]+)\s*/\s*\$?([0-9,.]+)\s+remaining",
        line,
    ) {
        if values[1] > 0.0 {
            push(
                windows,
                "free",
                "Free allowance",
                (1.0 - values[0] / values[1]) * 100.0,
            );
        }
    }
}

fn parse_tier(line: &str, windows: &mut Vec<UsageWindow>) {
    if let Some(values) = capture(
        r"agent usage\s+\$([0-9,.]+)\s+of\s+\$([0-9,.]+)\s+remaining",
        line,
    ) {
        if values[1] > 0.0 {
            push(
                windows,
                "agent",
                "Agent · Monthly",
                (1.0 - values[0] / values[1]) * 100.0,
            );
        }
    }
    if let Some(values) = capture(
        r"orb usage\s+([0-9,.]+)h\s+of\s+([0-9,.]+)h\s+a1\.small orb hours remaining",
        line,
    ) {
        if values[1] > 0.0 {
            push(
                windows,
                "orb",
                "Orb · Monthly",
                (1.0 - values[0] / values[1]) * 100.0,
            );
        }
    }
}

fn parse_subscription(line: &str, windows: &mut Vec<UsageWindow>) {
    if let Some(values) = capture(
        r":\s*([0-9,.]+)\s*%\s+other usage and\s+([0-9,.]+)\s*%\s+orb usage remaining",
        line,
    ) {
        push(windows, "agent", "Agent · Monthly", 100.0 - values[0]);
        push(windows, "orb", "Orb · Monthly", 100.0 - values[1]);
    }
}
