//! Keep AppImage runtime libraries out of host shells and programs.
//! Never mutate the app's environment: WebKit still needs bundled libraries.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

pub fn overrides() -> Vec<(OsString, Option<OsString>)> {
    if !cfg!(target_os = "linux") {
        return Vec::new();
    }
    clean(std::env::vars_os().collect())
}

fn clean(env: Vec<(OsString, OsString)>) -> Vec<(OsString, Option<OsString>)> {
    let Some((_, root)) = env.iter().find(|(key, _)| key == "APPDIR") else {
        return Vec::new();
    };
    let root = PathBuf::from(root);
    if !root.is_absolute() || root.parent().is_none() {
        return Vec::new();
    }
    let in_bundle = |path: &Path| path.starts_with(&root);
    let mut result = Vec::new();
    for (key, value) in env {
        if matches!(key.to_str(), Some("APPDIR" | "APPIMAGE" | "ARGV0" | "OWD")) {
            result.push((key, None));
        } else if matches!(
            key.to_str(),
            Some(
                "PATH"
                    | "PYTHONHOME"
                    | "PYTHONPATH"
                    | "LD_LIBRARY_PATH"
                    | "GTK_PATH"
                    | "GTK_EXE_PREFIX"
                    | "GTK_DATA_PREFIX"
                    | "GIO_MODULE_DIR"
                    | "GIO_EXTRA_MODULES"
                    | "GDK_PIXBUF_MODULE_FILE"
                    | "GDK_PIXBUF_MODULEDIR"
                    | "GSETTINGS_SCHEMA_DIR"
                    | "XDG_DATA_DIRS"
            )
        ) {
            let paths: Vec<_> = std::env::split_paths(&value)
                .filter(|p| !in_bundle(p))
                .collect();
            if let Ok(filtered) = std::env::join_paths(paths) {
                result.push((
                    key,
                    if filtered.is_empty() {
                        None
                    } else {
                        Some(filtered)
                    },
                ));
            }
        } else if key == "LD_PRELOAD" {
            let filtered = value
                .to_string_lossy()
                .split([' ', ':'])
                .filter(|p| !p.is_empty() && !in_bundle(Path::new(p)))
                .collect::<Vec<_>>()
                .join(" ");
            result.push((
                key,
                if filtered.is_empty() {
                    None
                } else {
                    Some(filtered.into())
                },
            ));
        }
    }
    result
}

pub fn command(program: impl AsRef<OsStr>) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    for (key, value) in overrides() {
        match value {
            Some(value) => {
                command.env(key, value);
            }
            None => {
                command.env_remove(key);
            }
        }
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_bundle_libraries_and_keeps_host_paths() {
        let env = [
            ("APPDIR", "/tmp/.mount_agent-test"),
            (
                "LD_LIBRARY_PATH",
                "/tmp/.mount_agent-test/usr/lib:/opt/host/lib",
            ),
            (
                "LD_PRELOAD",
                "/tmp/.mount_agent-test/exec.so /opt/host/preload.so",
            ),
            ("PATH", "/tmp/.mount_agent-test/usr/bin:/usr/bin:/bin"),
            ("PYTHONHOME", "/tmp/.mount_agent-test/usr"),
            (
                "PYTHONPATH",
                "/tmp/.mount_agent-test/usr/share/pyshared:/opt/host/python",
            ),
            (
                "GIO_MODULE_DIR",
                "/tmp/.mount_agent-test/usr/lib/gio/modules",
            ),
        ]
        .map(|(k, v)| (k.into(), v.into()))
        .to_vec();
        let result: std::collections::HashMap<_, _> = clean(env).into_iter().collect();
        assert_eq!(
            result[OsStr::new("LD_LIBRARY_PATH")],
            Some("/opt/host/lib".into())
        );
        assert_eq!(
            result[OsStr::new("LD_PRELOAD")],
            Some("/opt/host/preload.so".into())
        );
        assert_eq!(result[OsStr::new("PATH")], Some("/usr/bin:/bin".into()));
        assert_eq!(result[OsStr::new("GIO_MODULE_DIR")], None);
        assert_eq!(result[OsStr::new("APPDIR")], None);
        assert_eq!(result[OsStr::new("PYTHONHOME")], None);
        assert_eq!(
            result[OsStr::new("PYTHONPATH")],
            Some("/opt/host/python".into())
        );
    }

    #[test]
    fn leaves_non_appimage_environments_untouched() {
        assert!(clean(vec![("LD_LIBRARY_PATH".into(), "/opt/lib".into())]).is_empty());
    }

    #[test]
    fn removes_fully_bundled_library_path() {
        let result = clean(vec![
            ("APPDIR".into(), "/tmp/app".into()),
            ("LD_LIBRARY_PATH".into(), "/tmp/app/usr/lib".into()),
        ]);
        assert!(result.contains(&("LD_LIBRARY_PATH".into(), None)));
    }
}
