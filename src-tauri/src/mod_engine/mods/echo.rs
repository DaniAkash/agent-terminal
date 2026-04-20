use crate::mod_engine::{Mod, ModContext};

/// Pipeline smoke-test MOD. Emits one `opened` event on tab open and one
/// `closed` event on tab close — just enough to verify the full
/// Rust → Tauri event → frontend pipeline works end-to-end.
///
/// Does NOT emit on every PTY output chunk (that would spam the frontend).
/// Remove or cfg-gate this MOD before a production release.
pub struct EchoMod;

impl Mod for EchoMod {
    fn id(&self) -> &'static str {
        "echo"
    }

    fn on_open(&mut self, ctx: &ModContext) {
        ctx.emit(self.id(), "opened", serde_json::json!({}));
    }

    fn on_close(&mut self, ctx: &ModContext) {
        ctx.emit(self.id(), "closed", serde_json::json!({}));
    }
}
