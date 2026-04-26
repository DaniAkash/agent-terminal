use std::collections::HashMap;

use super::context::{AgentSignal, AgentSignalKind, CwdUpdate, ModContext, ModEvent};
use super::Mod;
use crate::hook_server::HookPayload;
use tauri::{AppHandle, Emitter, async_runtime};
use tokio::sync::mpsc;

pub(super) enum ModMessage {
    Open { tab_id: String, shell_pid: u32 },
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
    pub fn on_tab_open(&self, tab_id: &str, shell_pid: u32) {
        let _ = self.lifecycle_tx.send(ModMessage::Open { tab_id: tab_id.to_string(), shell_pid });
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
///
/// Also creates the hook event channel. Call `hook_sender()` before `build()` to
/// get a sender you can pass to `start_hook_server()`.
pub struct ModEngineBuilder {
    mods: Vec<Box<dyn Mod>>,
    hook_tx: mpsc::UnboundedSender<HookPayload>,
    hook_rx: mpsc::UnboundedReceiver<HookPayload>,
}

impl ModEngineBuilder {
    pub fn with_mod(mut self, m: impl Mod) -> Self {
        self.mods.push(Box::new(m));
        self
    }

    /// Returns a sender for hook events. Pass this to `start_hook_server()`.
    pub fn hook_sender(&self) -> mpsc::UnboundedSender<HookPayload> {
        self.hook_tx.clone()
    }

    pub fn build(self, app: AppHandle) -> ModEngine {
        ModEngine::start(self.mods, self.hook_rx, app)
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
        let (hook_tx, hook_rx) = mpsc::unbounded_channel::<HookPayload>();
        ModEngineBuilder { mods: Vec::new(), hook_tx, hook_rx }
    }

    /// Returns a cheap cloneable handle suitable for passing to threads or commands.
    pub fn handle(&self) -> ModEngineHandle {
        self.handle.clone()
    }

    fn start(mods: Vec<Box<dyn Mod>>, mut hook_rx: mpsc::UnboundedReceiver<HookPayload>, app: AppHandle) -> Self {
        // Bounded channel for data messages (Output/Input/Resize).
        let (msg_tx, mut msg_rx) = mpsc::channel::<ModMessage>(512);
        // Unbounded channel for lifecycle messages (Open/Close) — never dropped.
        let (lifecycle_tx, mut lifecycle_rx) = mpsc::unbounded_channel::<ModMessage>();
        // Outbound event buffer to the frontend.
        let (event_tx, mut event_rx) = mpsc::channel::<ModEvent>(256);
        // CWD update channel: DirTrackerMod calls ctx.set_cwd() which sends here.
        let (cwd_tx, mut cwd_rx) = mpsc::channel::<CwdUpdate>(64);
        // Agent lifecycle channel: unbounded so lifecycle signals are never dropped.
        let (agent_tx, mut agent_rx) = mpsc::unbounded_channel::<AgentSignal>();

        let event_tx_dispatch = event_tx.clone();
        async_runtime::spawn(async move {
            let mut mods = mods;
            // Internal CWD table: tab_id → current cwd.
            let mut cwd_table: HashMap<String, String> = HashMap::new();
            // Shell PID table: tab_id → shell process PID.
            let mut shell_pid_table: HashMap<String, u32> = HashMap::new();

            // Macro to dispatch a ModMessage and drain CWD updates.
            macro_rules! handle_mod_msg {
                ($msg:expr) => {{
                    match $msg {
                        ModMessage::Open { tab_id, shell_pid } => {
                            shell_pid_table.insert(tab_id.clone(), shell_pid);
                            let current_cwd = cwd_table.get(&tab_id).cloned();
                            let ctx = ModContext::new(&tab_id, &event_tx_dispatch, &cwd_tx, &agent_tx, current_cwd, shell_pid);
                            for m in &mut mods { m.on_open(&ctx); }
                        }
                        ModMessage::Close { tab_id } => {
                            let current_cwd = cwd_table.get(&tab_id).cloned();
                            let shell_pid = shell_pid_table.get(&tab_id).copied().unwrap_or(0);
                            let ctx = ModContext::new(&tab_id, &event_tx_dispatch, &cwd_tx, &agent_tx, current_cwd, shell_pid);
                            for m in &mut mods { m.on_close(&ctx); }
                            cwd_table.remove(&tab_id);
                            shell_pid_table.remove(&tab_id);
                        }
                        ModMessage::Output { tab_id, data } => {
                            let current_cwd = cwd_table.get(&tab_id).cloned();
                            let shell_pid = shell_pid_table.get(&tab_id).copied().unwrap_or(0);
                            let ctx = ModContext::new(&tab_id, &event_tx_dispatch, &cwd_tx, &agent_tx, current_cwd, shell_pid);
                            for m in &mut mods { m.on_output(&data, &ctx); }
                        }
                        ModMessage::Input { tab_id, data } => {
                            let current_cwd = cwd_table.get(&tab_id).cloned();
                            let shell_pid = shell_pid_table.get(&tab_id).copied().unwrap_or(0);
                            let ctx = ModContext::new(&tab_id, &event_tx_dispatch, &cwd_tx, &agent_tx, current_cwd, shell_pid);
                            for m in &mut mods { m.on_input(&data, &ctx); }
                        }
                        ModMessage::Resize { tab_id, cols, rows } => {
                            let current_cwd = cwd_table.get(&tab_id).cloned();
                            let shell_pid = shell_pid_table.get(&tab_id).copied().unwrap_or(0);
                            let ctx = ModContext::new(&tab_id, &event_tx_dispatch, &cwd_tx, &agent_tx, current_cwd, shell_pid);
                            for m in &mut mods { m.on_resize(cols, rows, &ctx); }
                        }
                    }
                    // Drain CWD updates produced during this dispatch round.
                    let mut cwd_updates: Vec<(String, String)> = Vec::new();
                    while let Ok(upd) = cwd_rx.try_recv() {
                        cwd_table.insert(upd.tab_id.clone(), upd.cwd.clone());
                        cwd_updates.push((upd.tab_id, upd.cwd));
                    }
                    for (tab_id, cwd) in &cwd_updates {
                        let shell_pid = shell_pid_table.get(tab_id).copied().unwrap_or(0);
                        let ctx = ModContext::new(tab_id, &event_tx_dispatch, &cwd_tx, &agent_tx, Some(cwd.clone()), shell_pid);
                        for m in &mut mods { m.on_cwd_changed(cwd, &ctx); }
                    }
                }};
            }

            loop {
                tokio::select! {
                    biased;
                    msg = lifecycle_rx.recv() => {
                        let Some(msg) = msg else { break };
                        handle_mod_msg!(msg);
                    }
                    msg = msg_rx.recv() => {
                        let Some(msg) = msg else { break };
                        handle_mod_msg!(msg);
                    }
                    // Agent lifecycle signals from ProcessInspectorMod's timer task.
                    // Processed immediately so idle tabs (no PTY activity) still get
                    // state transitions when an agent starts or exits.
                    sig = agent_rx.recv() => {
                        let Some(sig) = sig else { break };
                        let current_cwd = cwd_table.get(&sig.tab_id).cloned();
                        let shell_pid = shell_pid_table.get(&sig.tab_id).copied().unwrap_or(0);
                        let ctx = ModContext::new(&sig.tab_id, &event_tx_dispatch, &cwd_tx, &agent_tx, current_cwd, shell_pid);
                        match sig.kind {
                            AgentSignalKind::Detected => {
                                for m in &mut mods { m.on_agent_detected(&sig.agent, &sig.cwd, &sig.cmd, &ctx); }
                            }
                            AgentSignalKind::Cleared => {
                                for m in &mut mods { m.on_agent_cleared(&sig.agent, &ctx); }
                            }
                        }
                    }
                    // Hook events from the HTTP server. Not tab-scoped at the engine
                    // level — AgentTurnMod resolves the tab internally via session_id /
                    // CWD matching and emits directly via its own AsyncEmitter map.
                    hook = hook_rx.recv() => {
                        let Some(payload) = hook else { break };
                        for m in &mut mods { m.on_hook_event(&payload); }
                    }
                }
            }
        });

        // Task 2: forward ModEvents to the Tauri frontend.
        async_runtime::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                app.emit("mod:event", &event).ok();
            }
        });

        Self { handle: ModEngineHandle { tx: msg_tx, lifecycle_tx } }
    }
}
