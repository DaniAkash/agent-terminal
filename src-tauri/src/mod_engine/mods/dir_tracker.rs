use std::collections::HashMap;

use crate::mod_engine::{CwdRegistry, Mod, ModContext};
use crate::mod_engine::osc_parser::OscParser;

/// Watches OSC 7 sequences in PTY output and updates the shared `CwdRegistry`.
///
/// OSC 7 format: `\x1b]7;file://hostname/path\x07`
///
/// Emits a `cwd_changed` event to the frontend whenever the directory changes.
pub struct DirTrackerMod {
    cwd_registry: CwdRegistry,
    parsers: HashMap<String, OscParser>,
}

impl DirTrackerMod {
    pub fn new(cwd_registry: CwdRegistry) -> Self {
        Self {
            cwd_registry,
            parsers: HashMap::new(),
        }
    }
}

impl Mod for DirTrackerMod {
    fn id(&self) -> &'static str {
        "dir_tracker"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        self.parsers.insert(ctx.tab_id.to_string(), OscParser::new());
    }

    fn on_output(&mut self, data: &[u8], ctx: &ModContext) {
        let Some(parser) = self.parsers.get_mut(ctx.tab_id) else {
            return;
        };

        for seq in parser.feed(data) {
            if seq.code != 7 {
                continue;
            }
            // OSC 7 arg: "file://hostname/path" or "file:///path"
            let Some(path) = parse_osc7_path(&seq.arg) else {
                continue;
            };

            // Write to registry (legacy — still consumed by ClaudeCodeMod/CodexMod)
            {
                let mut reg = self.cwd_registry.write().unwrap();
                reg.insert(ctx.tab_id.to_string(), path.clone());
            }
            // Signal engine via new push model so on_cwd_changed fires on all mods
            ctx.set_cwd(&path);

            ctx.emit(
                self.id(),
                "cwd_changed",
                serde_json::json!({ "cwd": path }),
            );
        }
    }

    fn on_close(&mut self, ctx: &ModContext) {
        self.parsers.remove(ctx.tab_id);
        {
            let mut reg = self.cwd_registry.write().unwrap();
            reg.remove(ctx.tab_id);
        }
        // Signal the frontend to GC tabMeta for this tab.
        ctx.emit(self.id(), "closed", serde_json::json!({}));
    }
}

/// Parse `file://hostname/path` or `file:///path` into a decoded filesystem path.
fn parse_osc7_path(arg: &str) -> Option<String> {
    // Strip the file:// scheme prefix
    let rest = arg.strip_prefix("file://")?;

    // rest is now either:
    //   "hostname/path/to/dir"  (standard)
    //   "/path/to/dir"          (localhost with triple slash)
    let path_start = if rest.starts_with('/') {
        // Triple-slash: file:///path → rest = /path
        0
    } else {
        // Skip the hostname up to the first '/'
        rest.find('/')?
    };

    let encoded_path = &rest[path_start..];
    // URL-decode the path (handles %20, %2F, etc.)
    let decoded = percent_decode(encoded_path);
    Some(decoded)
}

/// Minimal percent-decoding for path strings.
/// Decodes `%XX` sequences where XX is a valid hex byte.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (
                hex_val(bytes[i + 1]),
                hex_val(bytes[i + 2]),
            ) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
