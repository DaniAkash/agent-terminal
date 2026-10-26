use super::types::{now, Preferences, ProviderUsage, UsageSnapshot, UsageStatus};
use super::{http, preferences, providers};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::Notify;

#[derive(Clone)]
pub struct UsageService(Arc<Inner>);

struct Inner {
    app: tauri::AppHandle,
    state: Mutex<State>,
    save_lock: tokio::sync::Mutex<()>,
    wake: Notify,
    discovery_wake: Notify,
    stopped: AtomicBool,
    client: Result<reqwest::Client, String>,
}

struct State {
    snapshot: UsageSnapshot,
    owners: HashMap<String, String>,
    generation: u64,
}

impl UsageService {
    pub fn new(app: tauri::AppHandle) -> Self {
        let loaded = preferences::config_path()
            .ok_or_else(|| "Jarvis settings location is unavailable.".to_string())
            .and_then(|path| preferences::load(&path));
        let (prefs, error) = match loaded {
            Ok(prefs) => (prefs, None),
            Err(error) => (Preferences::defaults(), Some(error)),
        };
        let snapshot = UsageSnapshot {
            revision: 0,
            providers: providers::PROVIDERS
                .iter()
                .map(|p| ProviderUsage::empty(p.id, p.name, prefs.collects(p.id)))
                .collect(),
            preferences: prefs,
            refreshing: false,
            claude_keychain_supported: cfg!(target_os = "macos"),
            settings_error: error,
        };
        Self(Arc::new(Inner {
            app,
            state: Mutex::new(State {
                snapshot,
                owners: HashMap::new(),
                generation: 0,
            }),
            save_lock: tokio::sync::Mutex::new(()),
            wake: Notify::new(),
            discovery_wake: Notify::new(),
            stopped: AtomicBool::new(false),
            client: http::client(),
        }))
    }

    pub fn start(&self) {
        self.publish();
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            service.run_discovery().await;
        });
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            service.run().await;
        });
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(30));
            loop {
                tick.tick().await;
                if service.0.stopped.load(Ordering::Relaxed) {
                    break;
                }
                if service.snapshot().preferences.enabled {
                    service.publish();
                }
            }
        });
    }

    pub fn stop(&self) {
        self.0.stopped.store(true, Ordering::Relaxed);
        self.0.wake.notify_one();
        self.0.discovery_wake.notify_one();
    }

    pub fn snapshot(&self) -> UsageSnapshot {
        let mut snapshot = self.0.state.lock().unwrap().snapshot.clone();
        age_snapshot(&mut snapshot, now());
        snapshot
    }

    pub fn refresh(&self) {
        self.rescan_agents();
        let snapshot = self.snapshot();
        if snapshot.preferences.enabled && !snapshot.refreshing {
            self.0.wake.notify_one();
        }
    }

    pub fn rescan_agents(&self) {
        self.0.discovery_wake.notify_one();
    }

    pub async fn scan_agents(&self) -> Result<(), String> {
        let found = tokio::task::spawn_blocking(super::discovery::scan)
            .await
            .map_err(|_| "Could not scan installed agents.".to_string())?;
        let changed = {
            let mut state = self.0.state.lock().unwrap();
            let mut changed = false;
            for (id, installed) in found {
                if let Some(row) = state.snapshot.providers.iter_mut().find(|p| p.id == id) {
                    changed |= row.detected != Some(installed);
                    row.detected = Some(installed);
                }
            }
            changed
        };
        if changed {
            self.publish();
        }
        Ok(())
    }

    async fn run_discovery(&self) {
        loop {
            if self.0.stopped.load(Ordering::Relaxed) {
                break;
            }
            let _ = self.scan_agents().await;
            tokio::select! {
                _ = self.0.discovery_wake.notified() => {},
                _ = tokio::time::sleep(Duration::from_secs(60)) => {},
            }
        }
    }

    pub async fn set_preferences(&self, prefs: Preferences) -> Result<UsageSnapshot, String> {
        let prefs = preferences::validate(prefs)?;
        let _guard = self.0.save_lock.lock().await;
        let path = preferences::config_path().ok_or("Jarvis settings location is unavailable.")?;
        let saved = prefs.clone();
        tokio::task::spawn_blocking(move || preferences::save(&path, &saved))
            .await
            .map_err(|_| "Could not save Jarvis settings.")??;
        {
            let mut state = self.0.state.lock().unwrap();
            if state.snapshot.preferences == prefs && state.snapshot.settings_error.is_none() {
                return Ok(state.snapshot.clone());
            }
            state.generation += 1;
            state.snapshot.preferences = prefs.clone();
            state.snapshot.settings_error = None;
            state.snapshot.refreshing = false;
            for row in &mut state.snapshot.providers {
                let detected = row.detected;
                if !prefs.collects(&row.id) {
                    *row = ProviderUsage::empty(&row.id, &row.name, false);
                } else if row.status == UsageStatus::Disabled {
                    *row = ProviderUsage::empty(&row.id, &row.name, true);
                }
                row.detected = detected;
            }
            state.owners.retain(|id, _| prefs.collects(id));
        }
        self.publish();
        self.0.wake.notify_one();
        Ok(self.snapshot())
    }

    pub(super) fn publish(&self) {
        let snapshot = {
            let mut state = self.0.state.lock().unwrap();
            state.snapshot.revision += 1;
            let mut snapshot = state.snapshot.clone();
            age_snapshot(&mut snapshot, now());
            snapshot
        };
        let _ = self.0.app.emit("jarvis:updated", snapshot);
    }

    async fn run(&self) {
        let mut last_start: Option<tokio::time::Instant> = None;
        loop {
            if self.0.stopped.load(Ordering::Relaxed) {
                break;
            }
            let prefs = self.snapshot().preferences;
            if !prefs.enabled || prefs.providers.is_empty() {
                self.0.wake.notified().await;
                continue;
            }
            // Coalesce manual clicks and settings changes without hammering an API.
            if let Some(last) = last_start {
                let remaining = Duration::from_secs(15).saturating_sub(last.elapsed());
                tokio::select! {
                    _ = self.0.wake.notified() => continue,
                    _ = tokio::time::sleep(remaining) => {},
                }
            }
            last_start = Some(tokio::time::Instant::now());
            tokio::select! {
                biased;
                _ = self.0.wake.notified() => continue,
                _ = self.collect_round() => {},
            }
            if prefs.refresh_seconds == 0 {
                self.0.wake.notified().await;
            } else {
                tokio::select! {
                    _ = self.0.wake.notified() => {},
                    _ = tokio::time::sleep(Duration::from_secs(prefs.refresh_seconds)) => {},
                }
            }
        }
    }

    async fn collect_round(&self) {
        let (prefs, generation) = {
            let mut state = self.0.state.lock().unwrap();
            state.snapshot.refreshing = true;
            (state.snapshot.preferences.clone(), state.generation)
        };
        self.publish();
        let mut workers = tokio::task::JoinSet::new();
        for provider in providers::PROVIDERS.iter().filter(|p| prefs.collects(p.id)) {
            let client = self.0.client.clone();
            workers.spawn(async move {
                let outcome = match client {
                    Ok(client) => providers::collect(provider, &client).await,
                    Err(error) => providers::Outcome {
                        owner: None,
                        result: Err(super::types::CollectionError::temporary(error)),
                    },
                };
                (provider.id, outcome)
            });
        }
        while let Some(result) = workers.join_next().await {
            if let Ok((id, outcome)) = result {
                let mut state = self.0.state.lock().unwrap();
                if state.generation != generation {
                    return;
                }
                let same_owner =
                    outcome.owner.is_some() && state.owners.get(id) == outcome.owner.as_ref();
                if let Some(row) = state.snapshot.providers.iter_mut().find(|p| p.id == id) {
                    apply_outcome(row, &outcome, same_owner, now());
                }
                if let Some(owner) = outcome.owner {
                    state.owners.insert(id.into(), owner);
                } else {
                    state.owners.remove(id);
                }
                drop(state);
                self.publish();
            }
        }
        {
            let mut state = self.0.state.lock().unwrap();
            if state.generation != generation {
                return;
            }
            state.snapshot.refreshing = false;
        }
        self.publish();
    }
}

pub(super) fn age_snapshot(snapshot: &mut UsageSnapshot, at: i64) {
    let max_age = snapshot
        .preferences
        .refresh_seconds
        .saturating_mul(2)
        .max(300) as i64;
    for row in &mut snapshot.providers {
        let expired = row
            .windows
            .iter()
            .any(|w| w.resets_at.is_some_and(|r| r <= at));
        let old = row
            .updated_at
            .is_some_and(|time| at.saturating_sub(time) > max_age);
        if row.status == UsageStatus::Available && (old || expired) {
            row.status = UsageStatus::Stale;
            row.message = Some("Last-known usage. Refresh for a current reading.".into());
        }
    }
}

pub(super) fn apply_outcome(
    row: &mut ProviderUsage,
    outcome: &providers::Outcome,
    same_owner: bool,
    at: i64,
) {
    row.attempted_at = Some(at);
    match &outcome.result {
        Ok(usage) => {
            row.status = UsageStatus::Available;
            row.windows = usage.windows.clone();
            row.source = Some(usage.source.clone());
            row.updated_at = Some(at);
            row.message = None;
        }
        Err(error) => {
            row.message = Some(error.message.clone());
            if error.transient && same_owner && !row.windows.is_empty() {
                row.status = UsageStatus::Stale;
            } else {
                row.status = error.status;
                row.windows.clear();
                row.source = None;
                row.updated_at = None;
            }
        }
    }
}
