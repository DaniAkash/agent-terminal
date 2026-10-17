use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UsageStatus {
    Disabled,
    Pending,
    Available,
    NotConfigured,
    Unsupported,
    Stale,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub id: String,
    pub label: String,
    pub used_percent: f64,
    pub resets_at: Option<i64>,
}

impl UsageWindow {
    pub fn new(id: &str, label: &str, used: f64, reset: Option<i64>) -> Option<Self> {
        if !used.is_finite() || used < 0.0 {
            return None;
        }
        Some(Self {
            id: id.into(),
            label: label.chars().filter(|c| !c.is_control()).take(80).collect(),
            used_percent: used.min(100.0),
            resets_at: reset.filter(|r| *r > 0),
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    pub id: String,
    pub name: String,
    pub status: UsageStatus,
    pub detected: Option<bool>,
    pub windows: Vec<UsageWindow>,
    pub source: Option<String>,
    pub updated_at: Option<i64>,
    pub attempted_at: Option<i64>,
    pub message: Option<String>,
}

impl ProviderUsage {
    pub fn empty(id: &str, name: &str, enabled: bool) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            status: if enabled {
                UsageStatus::Pending
            } else {
                UsageStatus::Disabled
            },
            detected: None,
            windows: Vec::new(),
            source: None,
            updated_at: None,
            attempted_at: None,
            message: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub show_tray: bool,
    #[serde(default = "default_refresh")]
    pub refresh_seconds: u64,
    #[serde(default)]
    pub providers: Vec<String>,
}

fn default_refresh() -> u64 {
    300
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: false,
            show_tray: false,
            refresh_seconds: default_refresh(),
            providers: vec![],
        }
    }
}

impl Preferences {
    pub fn defaults() -> Self {
        Self::default()
    }
    pub fn collects(&self, id: &str) -> bool {
        self.enabled && self.providers.iter().any(|p| p == id)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub revision: u64,
    pub preferences: Preferences,
    pub providers: Vec<ProviderUsage>,
    pub refreshing: bool,
    pub tray_supported: bool,
    pub claude_keychain_supported: bool,
    pub tray_error: Option<String>,
    pub settings_error: Option<String>,
}

impl UsageSnapshot {
    /// Expired windows and failed samples never drive a live meter.
    pub fn most_constrained(&self) -> Option<(&ProviderUsage, &UsageWindow)> {
        self.providers
            .iter()
            .filter(|p| self.preferences.collects(&p.id) && p.status == UsageStatus::Available)
            .flat_map(|p| {
                p.windows
                    .iter()
                    .filter(|w| w.resets_at.map_or(true, |r| r > now()))
                    .map(move |w| (p, w))
            })
            .max_by(|a, b| a.1.used_percent.total_cmp(&b.1.used_percent))
    }
}

#[derive(Clone, Debug)]
pub struct CollectionError {
    pub status: UsageStatus,
    pub message: String,
    pub transient: bool,
}

impl CollectionError {
    pub fn new(status: UsageStatus, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            transient: false,
        }
    }
    pub fn temporary(message: impl Into<String>) -> Self {
        Self {
            status: UsageStatus::Error,
            message: message.into(),
            transient: true,
        }
    }
    pub fn malformed() -> Self {
        Self::new(
            UsageStatus::Error,
            "The provider returned an unrecognized usage response.",
        )
    }
}

pub struct CollectedUsage {
    pub windows: Vec<UsageWindow>,
    pub source: String,
}
