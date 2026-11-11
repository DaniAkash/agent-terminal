//! Add installed user tools to a Linux desktop launcher's minimal PATH.
//! Shell startup files retain the final say; existing PATH order always wins.

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

type Environment = HashMap<OsString, OsString>;

pub fn shell_path(home: &Path, namespace: &str, inherited: Option<&OsStr>) -> Option<OsString> {
    let mut env: Environment = std::env::vars_os().collect();
    // The PTY builder has already removed AppImage entries from this value.
    if let Some(path) = inherited {
        env.insert("PATH".into(), path.to_owned());
    } else {
        env.remove(OsStr::new("PATH"));
    }
    let config_root = env
        .get(OsStr::new("XDG_CONFIG_HOME"))
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| home.join(".config"));
    let file = config_root.join(namespace).join("environment.json");
    let extra = read_extra_paths(&file);
    prepare(&env, home, &extra)
}

fn read_extra_paths(file: &Path) -> Vec<String> {
    let content = match std::fs::read_to_string(file) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(error) => {
            eprintln!("[shell-env] cannot read {}: {error}", file.display());
            return Vec::new();
        }
    };
    match serde_json::from_str::<serde_json::Value>(&content)
        .ok()
        .and_then(|value| value.get("extraPaths").cloned())
    {
        Some(serde_json::Value::Array(paths)) if paths.iter().all(|p| p.is_string()) => paths
            .into_iter()
            .filter_map(|p| p.as_str().map(str::to_owned))
            .collect(),
        _ => {
            eprintln!(
                "[shell-env] {} must contain an extraPaths array of strings",
                file.display()
            );
            Vec::new()
        }
    }
}

fn expand_directory(value: &OsStr, home: &Path) -> Option<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute() {
        return Some(path.to_path_buf());
    }
    let text = value.to_str()?;
    if text == "~" || text == "${HOME}" {
        return Some(home.to_path_buf());
    }
    text.strip_prefix("~/")
        .or_else(|| text.strip_prefix("${HOME}/"))
        .map(|relative| home.join(relative))
}

fn npm_prefix(env: &Environment, home: &Path) -> Option<PathBuf> {
    for key in ["npm_config_prefix", "NPM_CONFIG_PREFIX"] {
        if let Some(value) = env.get(OsStr::new(key)) {
            return expand_directory(value, home);
        }
    }
    let file = env
        .get(OsStr::new("NPM_CONFIG_USERCONFIG"))
        .or_else(|| env.get(OsStr::new("npm_config_userconfig")))
        .and_then(|p| expand_directory(p, home))
        .unwrap_or_else(|| home.join(".npmrc"));
    let content = std::fs::read_to_string(file).ok()?;
    // Read only the literal prefix setting. Never evaluate shell code or log
    // .npmrc contents: that file may also hold registry credentials.
    content
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once('=')?;
            if key.trim() != "prefix" {
                return None;
            }
            let value = value.trim().trim_matches(['\'', '"']);
            expand_directory(OsStr::new(value), home)
        })
        .next_back()
}

fn prepare(env: &Environment, home: &Path, extra: &[String]) -> Option<OsString> {
    let inherited = env
        .get(OsStr::new("PATH"))
        .map(OsString::as_os_str)
        .unwrap_or_else(|| OsStr::new("/usr/local/bin:/usr/bin:/bin"));
    let mut paths = Vec::new();
    let mut seen = HashSet::new();
    for path in std::env::split_paths(inherited) {
        // Preserve explicit relative entries, but never add an empty entry
        // (which implicitly adds the current working directory).
        if !path.as_os_str().is_empty() && seen.insert(path.clone()) {
            paths.push(path);
        }
    }
    let mut candidates = Vec::new();
    for value in extra {
        if let Some(path) = expand_directory(OsStr::new(value), home) {
            candidates.push(path);
        } else {
            eprintln!("[shell-env] ignoring an extraPaths entry: expected an absolute or ~/ path");
        }
    }
    if let Some(prefix) = npm_prefix(env, home) {
        candidates.push(prefix.join("bin"));
    }
    if let Some(root) = env
        .get(OsStr::new("BUN_INSTALL"))
        .and_then(|p| expand_directory(p, home))
    {
        candidates.push(root.join("bin"));
    }
    if let Some(root) = env
        .get(OsStr::new("PNPM_HOME"))
        .and_then(|p| expand_directory(p, home))
    {
        candidates.push(root);
    }
    let cache = env
        .get(OsStr::new("XDG_CACHE_HOME"))
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| home.join(".cache"));
    candidates.extend([
        home.join(".local/bin"),
        home.join(".bun/bin"),
        cache.join(".bun/bin"),
        home.join(".npm-global/bin"),
        home.join(".cargo/bin"),
    ]);
    for path in candidates {
        let in_bundle = env
            .get(OsStr::new("APPDIR"))
            .map(PathBuf::from)
            .filter(|root| root.is_absolute() && root.parent().is_some())
            .is_some_and(|root| path.starts_with(root));
        if !in_bundle && path.is_dir() && seen.insert(path.clone()) {
            paths.push(path);
        }
    }
    std::env::join_paths(paths)
        .map_err(|error| {
            eprintln!("[shell-env] could not prepare PATH: {error}");
        })
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory(root: &Path, name: &str) -> PathBuf {
        let path = root.join(name);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn preserves_precedence_and_appends_installed_tools() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let first = directory(home, "selected-node/bin");
        let bun = directory(home, ".cache/.bun/bin");
        let local = directory(home, ".local/bin");
        let path = std::env::join_paths([first.clone(), first.clone()]).unwrap();
        let env = HashMap::from([("PATH".into(), path)]);
        let result: Vec<_> = std::env::split_paths(&prepare(&env, home, &[]).unwrap()).collect();
        assert_eq!(result, [first, local, bun]);
    }

    #[test]
    fn supports_custom_prefixes_and_paths_with_spaces() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let npm = directory(home, "npm prefix/bin");
        let bun = directory(home, "custom bun/bin");
        let pnpm = directory(home, "pnpm");
        std::fs::write(
            home.join(".npmrc"),
            "//registry.example/:_authToken=not-a-real-token\nprefix=\"${HOME}/npm prefix\"\n",
        )
        .unwrap();
        let env = HashMap::from([
            ("PATH".into(), "/usr/bin:/bin".into()),
            (
                "BUN_INSTALL".into(),
                home.join("custom bun").into_os_string(),
            ),
            ("PNPM_HOME".into(), pnpm.clone().into_os_string()),
        ]);
        let result: Vec<_> = std::env::split_paths(&prepare(&env, home, &[]).unwrap()).collect();
        assert!(result.ends_with(&[npm, bun, pnpm]));
    }

    #[test]
    fn npm_environment_prefix_overrides_user_file() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let configured = directory(home, "configured/bin");
        let overridden = directory(home, "overridden/bin");
        std::fs::write(
            home.join(".npmrc"),
            format!("prefix={}\n", home.join("configured").display()),
        )
        .unwrap();
        let env = HashMap::from([(
            "npm_config_prefix".into(),
            home.join("overridden").into_os_string(),
        )]);
        let result: Vec<_> = std::env::split_paths(&prepare(&env, home, &[]).unwrap()).collect();
        assert!(result.contains(&overridden));
        assert!(!result.contains(&configured));
    }

    #[test]
    fn ignores_missing_relative_and_bundled_candidates() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let bundle = directory(home, "app/usr/bin");
        let extra = directory(home, "my tools");
        let env = HashMap::from([
            ("APPDIR".into(), home.join("app").into_os_string()),
            ("PATH".into(), "/usr/bin::/bin".into()),
        ]);
        let extras = vec![
            "relative/path".into(),
            "~/missing".into(),
            "~/my tools".into(),
            bundle.to_string_lossy().into_owned(),
        ];
        let result: Vec<_> =
            std::env::split_paths(&prepare(&env, home, &extras).unwrap()).collect();
        assert_eq!(
            result,
            [PathBuf::from("/usr/bin"), PathBuf::from("/bin"), extra]
        );
    }

    #[test]
    fn malformed_config_does_not_prevent_startup() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("environment.json");
        std::fs::write(&file, "{invalid").unwrap();
        assert!(read_extra_paths(&file).is_empty());
        std::fs::write(&file, r#"{"extraPaths":["~/bin",42]}"#).unwrap();
        assert!(read_extra_paths(&file).is_empty());
        std::fs::write(&file, r#"{"extraPaths":["~/bin"]}"#).unwrap();
        assert_eq!(read_extra_paths(&file), ["~/bin"]);
    }

    #[test]
    fn no_installation_still_leaves_a_usable_system_path() {
        let temp = tempfile::tempdir().unwrap();
        let result = prepare(&HashMap::new(), temp.path(), &[]).unwrap();
        assert_eq!(result, OsStr::new("/usr/local/bin:/usr/bin:/bin"));
    }

    #[test]
    fn custom_xdg_cache_and_npm_userconfig_are_supported() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let bun = directory(home, "cache/.bun/bin");
        let npm = directory(home, "npm/bin");
        let config = home.join("custom.npmrc");
        std::fs::write(&config, format!("prefix={}\n", home.join("npm").display())).unwrap();
        let env = HashMap::from([
            ("XDG_CACHE_HOME".into(), home.join("cache").into_os_string()),
            ("NPM_CONFIG_USERCONFIG".into(), config.into_os_string()),
        ]);
        let paths: Vec<_> = std::env::split_paths(&prepare(&env, home, &[]).unwrap()).collect();
        assert!(paths.contains(&bun));
        assert!(paths.contains(&npm));
    }
}
