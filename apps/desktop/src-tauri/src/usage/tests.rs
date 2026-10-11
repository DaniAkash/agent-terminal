use super::types::*;
use super::{credentials, preferences, providers, service};
use serde_json::json;

#[test]
fn opencode_only_uses_its_own_api_keys_and_prefers_go() {
    let keys = credentials::opencode_keys(&json!({
        "opencode-go": {"type": "api", "key": "synthetic-go"},
        "opencode": {"type": "api", "key": "synthetic-zen"},
        "openai": {"type": "oauth", "access": "never-forward"},
        "anthropic": {"type": "api", "key": "never-forward"}
    }));
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0].token, "synthetic-go");
    assert_eq!(keys[1].token, "synthetic-zen");
    assert!(credentials::opencode_keys(&json!({
        "opencode-go": {"type": "oauth", "key": "never-forward"},
        "opencode": {"type": "api", "key": " "}
    }))
    .is_empty());
}

#[test]
fn opencode_entitlement_is_not_a_login_failure() {
    let error = super::http::classify_json(
        403,
        true,
        json!({
            "error": {"type": "EntitlementError", "message": "server text must not reach UI"}
        }),
    )
    .unwrap_err();
    assert_eq!(error.status, UsageStatus::Unsupported);
    assert!(!error.message.contains("server text"));
    let permission = super::http::classify_json(
        403,
        true,
        json!({
            "error": {"type": "PermissionError"}
        }),
    )
    .unwrap_err();
    assert_eq!(permission.status, UsageStatus::Error);
    assert!(super::http::classify_json(200, true, json!({"usage": {}})).is_ok());
}

#[test]
fn opencode_parses_real_api_shape_with_zero_and_full_usage() {
    let windows = providers::parse_opencode(&json!({"usage": {
        "rolling": {"percent": 0, "resetsAt": "2027-01-01T00:00:00Z"},
        "weekly": {"percent": 100, "resetsAt": "2027-01-01T00:00:00Z"},
        "monthly": {"percent": 0.5, "resetsAt": "2027-01-01T00:00:00Z"}
    }}));
    assert_eq!(windows.len(), 3);
    assert_eq!(windows[0].used_percent, 0.0);
    assert_eq!(windows[1].used_percent, 100.0);
    assert_eq!(windows[2].used_percent, 0.5);
    assert_eq!(windows[0].resets_at, Some(1798761600));
    assert!(providers::parse_opencode(&json!({"usage": {"rolling": {"percent": -1}}})).is_empty());
}

#[test]
fn codex_preserves_unknown_windows_and_partial_model_limits() {
    let windows = providers::parse_codex(&json!({
        "rate_limit": {
            "primary_window": {"used_percent": 12.5, "reset_at": 1800000000, "limit_window_seconds": 18000},
            "secondary_window": null
        },
        "additional_rate_limits": [
            {"limit_name": "Spark", "rate_limit": {"primary_window": {"used_percent": 91}}},
            {"limit_name": "Malformed", "rate_limit": {"primary_window": {"used_percent": null}}}
        ]
    }));
    assert_eq!(windows.len(), 2);
    assert_eq!(windows[0].used_percent, 12.5);
    assert_eq!(windows[0].label, "5 hours");
    assert_eq!(windows[0].resets_at, Some(1800000000));
    assert_eq!(windows[1].label, "Spark · Session");
    assert_eq!(windows[1].resets_at, None);
    assert!(providers::parse_codex(&json!({})).is_empty());
}

#[test]
fn claude_maps_model_windows_without_inventing_missing_percentages() {
    let windows = providers::parse_claude(&json!({
        "five_hour": {"utilization": 0, "resets_at": "2027-01-01T00:00:00Z"},
        "seven_day": {"utilization": null},
        "seven_day_sonnet": {"utilization": 78.25, "resets_at": "bad date"},
        "seven_day_opus": null
    }));
    assert_eq!(windows.len(), 2);
    assert_eq!(windows[0].used_percent, 0.0);
    assert_eq!(windows[0].resets_at, Some(1798761600));
    assert_eq!(windows[1].resets_at, None);
}

#[test]
fn opencode_keeps_fractional_percent_units() {
    let windows = providers::parse_opencode(&json!({"usage": {
        "rolling": {"percent": 0.5, "resetInSec": 60},
        "weekly": {"percent": 42}, "monthly": {"percent": null}
    }}));
    assert_eq!(windows.len(), 2);
    assert_eq!(windows[0].used_percent, 0.5);
    assert!(windows[0].resets_at.unwrap() >= now() + 59);
    assert_eq!(windows[1].resets_at, None);
}

#[test]
fn kimi_supports_legacy_counts_and_new_ratio_pools() {
    let legacy = providers::parse_kimi(&json!({
        "usage": {"limit": "2048", "used": "214", "resetTime": "2027-01-01T00:00:00Z"},
        "limits": [{"window": {"duration": 300, "timeUnit": "TIME_UNIT_MINUTE"},
            "detail": {"limit": "200", "remaining": "61"}}]
    }));
    assert_eq!(legacy.len(), 2);
    assert!((legacy[1].used_percent - 69.5).abs() < 1e-9);
    let current = providers::parse_kimi(&json!({
        "usages": {"limit_5h": {"used_ratio": 0.75}, "limit_7d": {"used_ratio": 0.2},
            "limit_month_total": {"used_ratio": 1.0, "reset_time": "2027-01-01T00:00:00Z"}},
        "usage": {"limit": "10", "used": "0"}
    }));
    assert_eq!(current.len(), 3);
    assert_eq!(current[1].used_percent, 20.0);
    assert_eq!(current[2].used_percent, 100.0);
    assert!(providers::parse_kimi(&json!({"usage": {"limit": "0", "used": "0"}})).is_empty());
}

#[test]
fn kilo_measures_the_pass_allowance_including_bonus() {
    let windows = providers::parse_kilo(&json!({"result": {"data": {"json": {
        "subscription": {"currentPeriodUsageUsd": 30, "currentPeriodBaseCreditsUsd": 40,
            "currentPeriodBonusCreditsUsd": 20, "nextBillingAt": "2027-01-01T00:00:00Z"}
    }}}}));
    assert_eq!(windows[0].used_percent, 50.0);
    assert_eq!(windows[0].resets_at, Some(1798761600));
    assert!(
        providers::parse_kilo(&json!({"result": {"data": {"json": {"subscription": null}}}}))
            .is_empty()
    );
}

#[test]
fn amp_parses_cli_variants_without_guessing_reset_dates() {
    let windows = providers::parse_amp("\x1b[32mAmp Free: 20% remaining today (resets daily)\x1b[0m\nAmp Pro Tier: agent usage $30 of $100 remaining, orb usage 1h of 10h a1.small orb hours remaining - resets upon renewal in 12 days\nIndividual credits: $44 remaining");
    assert_eq!(windows.len(), 3);
    assert_eq!(windows[0].used_percent, 80.0);
    assert_eq!(windows[1].used_percent, 70.0);
    assert_eq!(windows[2].used_percent, 90.0);
    assert!(windows.iter().all(|w| w.resets_at.is_none()));
    let legacy = providers::parse_amp("Amp Free: $5 / $10 remaining (replenishes +$1/hour)\nSubscription Pro: 40% other usage and 10% orb usage remaining - resets upon renewal in 5 days");
    assert_eq!(legacy.len(), 3);
    assert_eq!(legacy[0].used_percent, 50.0);
    assert!(providers::parse_amp("Signed out. Individual credits: $44 remaining").is_empty());
}

#[test]
fn invalid_percentages_never_create_a_zero_reading() {
    for used in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0] {
        assert!(UsageWindow::new("a", "a", used, None).is_none());
    }
    assert_eq!(
        UsageWindow::new("a", "a", 120.0, None)
            .unwrap()
            .used_percent,
        100.0
    );
    assert!(providers::ratio_window("a", "a", &json!({"limit": 0, "used": 0})).is_none());
}

fn row() -> ProviderUsage {
    let mut row = ProviderUsage::empty("codex", "Codex", true);
    row.windows = vec![UsageWindow::new("session", "Session", 70.0, None).unwrap()];
    row.status = UsageStatus::Available;
    row.updated_at = Some(1000);
    row.source = Some("Local OAuth session".into());
    row
}

#[test]
fn transient_failures_preserve_only_the_same_credential_owner() {
    let failure = providers::Outcome {
        owner: Some("fingerprint".into()),
        result: Err(CollectionError::temporary("Offline")),
    };
    let mut same = row();
    service::apply_outcome(&mut same, &failure, true, 1100);
    assert_eq!(same.status, UsageStatus::Stale);
    assert_eq!(same.updated_at, Some(1000));
    assert_eq!(same.windows.len(), 1);
    let mut changed = row();
    service::apply_outcome(&mut changed, &failure, false, 1100);
    assert!(changed.windows.is_empty());
    assert_eq!(changed.updated_at, None);
}

#[test]
fn auth_failure_clears_last_known_usage_even_for_the_same_owner() {
    let failure = providers::Outcome {
        owner: Some("fingerprint".into()),
        result: Err(CollectionError::new(
            UsageStatus::NotConfigured,
            "Expired session",
        )),
    };
    let mut row = row();
    service::apply_outcome(&mut row, &failure, true, 1100);
    assert_eq!(row.status, UsageStatus::NotConfigured);
    assert!(row.windows.is_empty());
    assert_eq!(row.source, None);
}

fn snapshot(provider: ProviderUsage) -> UsageSnapshot {
    UsageSnapshot {
        revision: 1,
        preferences: Preferences {
            enabled: true,
            providers: vec!["codex".into()],
            ..Preferences::default()
        },
        providers: vec![provider],
        refreshing: false,
        tray_supported: true,
        claude_keychain_supported: false,
        tray_error: None,
        settings_error: None,
    }
}

#[test]
fn old_and_expired_samples_are_marked_stale() {
    let mut old = snapshot(row());
    service::age_snapshot(&mut old, 1601);
    assert_eq!(old.providers[0].status, UsageStatus::Stale);
    assert!(old.most_constrained().is_none());
    let mut expired = snapshot(row());
    expired.providers[0].windows[0].resets_at = Some(1050);
    service::age_snapshot(&mut expired, 1100);
    assert_eq!(expired.providers[0].status, UsageStatus::Stale);
}

#[test]
fn preferences_round_trip_and_disabled_collection_are_explicit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("jarvis.json");
    assert!(!preferences::load(&path).unwrap().enabled);
    let prefs = preferences::validate(Preferences {
        enabled: true,
        show_tray: true,
        refresh_seconds: 300,
        providers: vec!["kimi".into(), "codex".into(), "codex".into()],
    })
    .unwrap();
    preferences::save(&path, &prefs).unwrap();
    assert_eq!(preferences::load(&path).unwrap(), prefs);
    assert_eq!(prefs.providers, vec!["codex", "kimi"]);
    assert!(!prefs.collects("amp"));
    assert!(!Preferences {
        enabled: false,
        ..prefs
    }
    .collects("codex"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}

#[test]
fn corrupt_or_newer_settings_fail_closed_without_overwriting_them() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("jarvis.json");
    for content in ["{", r#"{"version":2,"enabled":true}"#] {
        std::fs::write(&path, content).unwrap();
        assert!(preferences::load(&path).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
    }
    assert!(preferences::validate(Preferences {
        refresh_seconds: 2,
        ..Preferences::default()
    })
    .is_err());
    assert!(preferences::validate(Preferences {
        providers: vec!["unknown".into()],
        ..Preferences::default()
    })
    .is_err());
}

#[test]
fn missing_invalid_and_oversized_credentials_do_not_expose_contents() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("credentials.json");
    assert!(credentials::read_json(&path).is_err());
    std::fs::write(&path, "SYNTHETIC_SECRET_INVALID_JSON").unwrap();
    let error = credentials::read_json(&path).unwrap_err();
    assert_eq!(error.status, UsageStatus::NotConfigured);
    assert!(!error.message.contains("SYNTHETIC_SECRET"));
    std::fs::write(&path, vec![b'x'; 1024 * 1024 + 1]).unwrap();
    assert!(credentials::read_json(&path).is_err());
    assert!(credentials::read_json(dir.path()).is_err());
}

#[test]
fn snapshot_wire_shape_contains_no_credentials_or_internal_owners() {
    let value = serde_json::to_value(snapshot(row())).unwrap();
    assert_eq!(value["preferences"]["refreshSeconds"], 300);
    assert_eq!(value["providers"][0]["windows"][0]["usedPercent"], 70.0);
    assert_eq!(value["providers"][0]["status"], "available");
    assert!(value.get("owners").is_none());
    assert!(value["providers"][0].get("token").is_none());
    let ids: Vec<_> = providers::PROVIDERS.iter().map(|p| p.id).collect();
    assert!(crate::agents::AGENTS
        .iter()
        .all(|agent| ids.contains(&agent.id)));
}
