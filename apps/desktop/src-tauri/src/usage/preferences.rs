use super::providers::PROVIDERS;
use super::types::Preferences;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Deserialize, Serialize)]
struct SettingsFile {
    version: u32,
    #[serde(flatten)]
    preferences: Preferences,
}

pub fn config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join(".config")
            .join(crate::identity::NAMESPACE)
            .join("jarvis.json")
    })
}

pub fn validate(mut prefs: Preferences) -> Result<Preferences, String> {
    if ![0, 60, 300, 900].contains(&prefs.refresh_seconds) {
        return Err("Choose Manual, 1 minute, 5 minutes, or 15 minutes refresh.".into());
    }
    if prefs
        .providers
        .iter()
        .any(|id| !PROVIDERS.iter().any(|p| p.id == id))
    {
        return Err("Unknown Jarvis provider.".into());
    }
    prefs.providers = PROVIDERS
        .iter()
        .filter(|p| prefs.providers.iter().any(|id| id == p.id))
        .map(|p| p.id.to_string())
        .collect();
    Ok(prefs)
}

pub fn load(path: &Path) -> Result<Preferences, String> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Preferences::defaults()),
        Err(_) => return Err("Jarvis settings could not be read. Collection is paused.".into()),
    };
    let mut bytes = Vec::new();
    file.take(65_537)
        .read_to_end(&mut bytes)
        .map_err(|_| "Jarvis settings could not be read.")?;
    if bytes.len() > 65_536 {
        return Err("Jarvis settings are too large.".into());
    }
    let saved: SettingsFile = serde_json::from_slice(&bytes).map_err(|_| {
        "Jarvis settings are invalid. Collection is paused until settings are saved."
    })?;
    if saved.version != 1 {
        return Err("This Jarvis settings version is not supported.".into());
    }
    validate(saved.preferences)
}

pub fn save(path: &Path, prefs: &Preferences) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Jarvis settings location is unavailable.")?;
    fs::create_dir_all(parent).map_err(|_| "Could not create the Jarvis settings folder.")?;
    let temp = parent.join(format!(".jarvis-{}.tmp", uuid::Uuid::new_v4()));
    let result = write_atomic(&temp, path, prefs);
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
        .map_err(|_| "Could not save Jarvis settings. Your previous settings are preserved.".into())
}

fn write_atomic(temp: &Path, path: &Path, prefs: &Preferences) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(temp)?;
    let json = serde_json::to_vec_pretty(&SettingsFile {
        version: 1,
        preferences: prefs.clone(),
    })?;
    file.write_all(&json)?;
    file.sync_all()?;
    fs::rename(temp, path)?;
    Ok(())
}
