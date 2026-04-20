use super::context::{ModContext, ModEvent};
use super::Mod;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

pub(super) enum ModMessage {
    Open { tab_id: String },
    Close { tab_id: String },
    Output { tab_id: String, data: Vec<u8> },
    Input { tab_id: String, data: Vec<u8> },
    Resize { tab_id: String, cols: u16, rows: u16 },
}

/// Cheap, cloneable handle to the MOD engine. The PTY read thread and Tauri
/// commands clone this to dispatch events without holding a reference to
/// `ModEngine` itself.
///
/// All dispatch methods use `try_send` — they are non-blocking and silently
/// drop messages when the engine is behind. The terminal always gets its bytes;
/// MODs tolerate occasional dropped frames under extreme PTY load.
#[derive(Clone)]
pub struct ModEngineHandle {
    tx: mpsc::Sender<ModMessage>,
}

impl ModEngineHandle {
    pub fn on_tab_open(&self, tab_id: &str) {
        let _ = self.tx.try_send(ModMessage::Open { tab_id: tab_id.to_string() });
    }

    pub fn on_tab_close(&self, tab_id: &str) {
        let _ = self.tx.try_send(ModMessage::Close { tab_id: tab_id.to_string() });
    }

    pub fn on_output(&self, tab_id: &str, data: Vec<u8>) {
        let _ = self.tx.try_send(ModMessage::Output { tab_id: tab_id.to_string(), data });
    }

    pub fn on_input(&self, tab_id: &str, data: Vec<u8>) {
        let _ = self.tx.try_send(ModMessage::Input { tab_id: tab_id.to_string(), data });
    }

    pub fn on_resize(&self, tab_id: &str, cols: u16, rows: u16) {
        let _ = self.tx.try_send(ModMessage::Resize { tab_id: tab_id.to_string(), cols, rows });
    }
}

/// Collects MODs before building the engine.
pub struct ModEngineBuilder {
    mods: Vec<Box<dyn Mod>>,
}

impl ModEngineBuilder {
    pub fn with_mod(mut self, m: impl Mod) -> Self {
        self.mods.push(Box::new(m));
        self
    }

    pub fn build(self, app: AppHandle) -> ModEngine {
        ModEngine::start(self.mods, app)
    }
}

/// The MOD engine. Owns two background tokio tasks:
/// 1. Dispatcher — receives `ModMessage` items and calls each `Mod` in order.
/// 2. Emitter    — receives `ModEvent` items and forwards them to the frontend.
///
/// Placed in Tauri managed state. Commands call `engine.handle()` to get a
/// `ModEngineHandle` for dispatching; the PTY read thread clones that handle.
pub struct ModEngine {
    handle: ModEngineHandle,
}

impl ModEngine {
    pub fn builder() -> ModEngineBuilder {
        ModEngineBuilder { mods: Vec::new() }
    }

    /// Returns a cheap cloneable handle suitable for passing to threads or commands.
    pub fn handle(&self) -> ModEngineHandle {
        self.handle.clone()
    }

    fn start(mods: Vec<Box<dyn Mod>>, app: AppHandle) -> Self {
        // 512-message pipeline buffer. try_send drops when full so the PTY thread
        // is never blocked. 256-event outbound buffer to the frontend.
        let (msg_tx, mut msg_rx) = mpsc::channel::<ModMessage>(512);
        let (event_tx, mut event_rx) = mpsc::channel::<ModEvent>(256);

        // Task 1: dispatch PTY messages to every MOD in registration order.
        let event_tx_dispatch = event_tx.clone();
        tokio::spawn(async move {
            let mut mods = mods;
            while let Some(msg) = msg_rx.recv().await {
                match msg {
                    ModMessage::Open { tab_id } => {
                        let ctx = ModContext::new(&tab_id, &event_tx_dispatch);
                        for m in &mut mods { m.on_open(&ctx); }
                    }
                    ModMessage::Close { tab_id } => {
                        let ctx = ModContext::new(&tab_id, &event_tx_dispatch);
                        for m in &mut mods { m.on_close(&ctx); }
                    }
                    ModMessage::Output { tab_id, data } => {
                        let ctx = ModContext::new(&tab_id, &event_tx_dispatch);
                        for m in &mut mods { m.on_output(&data, &ctx); }
                    }
                    ModMessage::Input { tab_id, data } => {
                        let ctx = ModContext::new(&tab_id, &event_tx_dispatch);
                        for m in &mut mods { m.on_input(&data, &ctx); }
                    }
                    ModMessage::Resize { tab_id, cols, rows } => {
                        let ctx = ModContext::new(&tab_id, &event_tx_dispatch);
                        for m in &mut mods { m.on_resize(cols, rows, &ctx); }
                    }
                }
            }
        });

        // Task 2: forward ModEvents to the Tauri frontend.
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                app.emit("mod:event", &event).ok();
            }
        });

        Self { handle: ModEngineHandle { tx: msg_tx } }
    }
}
