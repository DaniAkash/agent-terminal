//! Executable discovery only: never reads sessions or launches an agent/shell.
use std::path::PathBuf;

pub fn binary(name: &str) -> Option<PathBuf> {
    which::which(name).ok().or_else(|| {
        search_dirs()
            .into_iter()
            .find_map(|dir| which::which_in(name, Some(dir.as_os_str()), &dir).ok())
    })
}

pub fn scan() -> Vec<(&'static str, bool)> {
    let dirs = search_dirs();
    super::providers::PROVIDERS
        .iter()
        .map(|provider| {
            let installed = crate::agents::by_id(provider.id).is_some_and(|agent| {
                agent.process_names.iter().any(|name| {
                    which::which(name).is_ok()
                        || dirs
                            .iter()
                            .any(|dir| which::which_in(name, Some(dir.as_os_str()), dir).is_ok())
                })
            });
            (provider.id, installed)
        })
        .collect()
}

fn search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(unix) {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    }
    if let Ok(home) = super::credentials::home() {
        dirs.extend(
            [
                ".local/bin",
                ".cargo/bin",
                ".bun/bin",
                ".npm-global/bin",
                ".npm/bin",
                ".amp/bin",
                ".opencode/bin",
                ".volta/bin",
                ".local/share/mise/shims",
                ".asdf/shims",
                "scoop/shims",
            ]
            .map(|path| home.join(path)),
        );
        // GUI launches often omit version-manager paths. Bound directory walks;
        // inspect only direct installation roots, never recurse into projects.
        for root in [
            home.join(".nvm/versions/node"),
            home.join(".local/share/fnm/node-versions"),
            home.join("Library/Application Support/fnm/node-versions"),
        ] {
            if let Ok(entries) = std::fs::read_dir(root) {
                for entry in entries.take(64).flatten() {
                    dirs.push(entry.path().join("bin"));
                    dirs.push(entry.path().join("installation/bin"));
                }
            }
        }
    }
    if cfg!(windows) {
        for (key, suffix) in [
            ("APPDATA", "npm"),
            ("LOCALAPPDATA", "Microsoft/WinGet/Links"),
        ] {
            if let Some(root) = std::env::var_os(key) {
                dirs.push(PathBuf::from(root).join(suffix));
            }
        }
    }
    dirs
}
