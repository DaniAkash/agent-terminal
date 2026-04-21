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
/// Lifecycle messages (`Open`/`Close`) use an unbounded channel — they are
/// never dropped, because losing them would leave MODs with uninitialised or
/// leaked per-tab state and prevent the frontend GC event (`closed`) from
/// firing.
///
/// Data messages (`Output`/`Input`/`Resize`) use a bounded channel (512).
/// `try_send` is non-blocking and silently drops under extreme PTY load so
/// the terminal thread is never stalled. MODs tolerate occasional missed frames.
#[derive(Clone)]
pub struct ModEngineHandle {
    /// Bounded channel for high-volume data messages (Output/Input/Resize).
    tx: mpsc::Sender<ModMessage>,
    /// Unbounded channel for lifecycle messages (Open/Close) — never dropped.
    lifecycle_tx: mpsc::UnboundedSender<ModMessage>,
}

impl ModEngineHandle {
    pub fn on_tab_open(&self, tab_id: &str) {
        let _ = self.lifecycle_tx.send(ModMessage::Open { tab_id: tab_id.to_string() });
    }

    pub fn on_tab_close(&self, tab_id: &str) {
        let _ = self.lifecycle_tx.send(ModMessage::Close { tab_id: tab_id.to_string() });
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
        // Bounded channel for data messages (Output/Input/Resize).
        // try_send drops when full so the PTY thread is never blocked.
        let (msg_tx, mut msg_rx) = mpsc::channel::<ModMessage>(512);
        // Unbounded channel for lifecycle messages (Open/Close) — never dropped.
        let (lifecycle_tx, mut lifecycle_rx) = mpsc::unbounded_channel::<ModMessage>();
        // Outbound event buffer to the frontend.
        let (event_tx, mut event_rx) = mpsc::channel::<ModEvent>(256);

        // Task 1: dispatch PTY messages to every MOD in registration order.
        // `biased` select gives lifecycle messages priority over data messages so
        // Open/Close are always processed before any buffered Output/Input/Resize
        // for the same tab.
        let event_tx_dispatch = event_tx.clone();
        tokio::spawn(async move {
            let mut mods = mods;
            loop {
                let msg = tokio::select! {
                    biased;
                    msg = lifecycle_rx.recv() => match msg {
                        Some(m) => m,
                        None => break,
                    },
                    msg = msg_rx.recv() => match msg {
                        Some(m) => m,
                        None => break,
                    },
                };
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

        Self { handle: ModEngineHandle { tx: msg_tx, lifecycle_tx } }
    }
}
