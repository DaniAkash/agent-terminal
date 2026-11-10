#[path = "../../src-tauri/src/host_env.rs"]
#[allow(dead_code)] // The harness exercises overrides; the GUI also uses command().
mod host_env;
#[path = "../../src-tauri/src/linux_path.rs"]
mod linux_path;

fn main() {
    let home = std::path::PathBuf::from(std::env::var_os("HOME").expect("HOME"));
    let mut env: std::collections::HashMap<_, _> = std::env::vars_os().collect();
    for (key, value) in host_env::overrides() {
        match value {
            Some(value) => {
                env.insert(key, value);
            }
            None => {
                env.remove(&key);
            }
        }
    }
    if let Some(path) = linux_path::shell_path(
        &home,
        "agent-terminal",
        env.get(std::ffi::OsStr::new("PATH")).map(|p| p.as_os_str()),
    ) {
        env.insert("PATH".into(), path);
    }
    // Test output is limited to the environment entries needed by the PTY
    // harness; never dump the parent process's secrets.
    let keys = [
        "PATH",
        "LD_LIBRARY_PATH",
        "LD_PRELOAD",
        "PYTHONHOME",
        "PYTHONPATH",
        "APPDIR",
    ];
    let output: std::collections::BTreeMap<_, _> = keys
        .into_iter()
        .map(|key| {
            (
                key,
                env.get(std::ffi::OsStr::new(key))
                    .map(|v| v.to_string_lossy().into_owned()),
            )
        })
        .collect();
    println!("{}", serde_json::to_string(&output).unwrap());
}
