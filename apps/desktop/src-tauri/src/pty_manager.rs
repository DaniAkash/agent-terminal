use crate::mod_engine::{CwdTable, ModEngineHandle};
use crate::projects_cache::ProjectsCache;
use crate::stream_hub::StreamHub;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri::ipc::Channel;

#[derive(Serialize, Clone)]
pub struct PtyDataPayload {
    pub data: String,
}

#[derive(Serialize, Clone)]
pub struct PtyExitPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
}

#[derive(Serialize, Clone)]
pub struct PtyRespawnPayload {
    #[serde(rename = "tabId")]
    pub tab_id: String,
    pub cwd: Option<String>,
}

/// Wrapped in Arc<Mutex<Option<...>>> so open_tab can swap in a new Channel
/// when the WebView reconnects without stopping or restarting the reader thread.
/// The Option is None when the WebView is disconnected — the reader discards
/// output silently during that window rather than exiting.
pub type SharedChannel = Arc<Mutex<Option<Channel<PtyDataPayload>>>>;

pub struct PtyHandle {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    /// The child process (shell or agent). Kept so open_tab can call try_wait()
    /// to distinguish "child still running but WebView disconnected" (healable)
    /// from "child exited and PTY is truly dead" (needs fresh spawn).
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    /// Flipped to false when the reader thread exits. Only exits on PTY EOF —
    /// not on channel failure. Used to know whether a new reader thread must be
    /// spawned if the reader somehow exited before the reconnect arrived.
    pub reader_alive: Arc<AtomicBool>,
    /// The live frontend channel. Swapped by open_tab on reconnect without
    /// touching the reader thread or the PTY process.
    pub channel: SharedChannel,
    /// Set true by `close_tab` BEFORE the entry is removed from PtyMap. Reader
    /// thread checks this on EOF: true → user closed the tab, emit pty:exit
    /// and quit; false → shell exited on its own (typed `exit`, segfault,
    /// etc.), trigger respawn.
    pub closing: Arc<AtomicBool>,
    /// Resolved absolute shell path (e.g. `/bin/zsh`). Captured at spawn time
    /// so respawn uses identically-resolved shell regardless of any later
    /// $SHELL change.
    pub shell_path: String,
    /// CWD passed at original tab open. Used as the respawn fallback when
    /// the engine's cwd_table has nothing for this tab — happens when the
    /// shell exits before any OSC 7 has been emitted (e.g. `exit` at the
    /// very first prompt).
    pub spawn_cwd: Option<String>,
    /// Timestamps of recent respawns. The reader thread checks this before
    /// respawning: if more than RESPAWN_RATE_MAX events fall inside
    /// RESPAWN_RATE_WINDOW, it bails out and emits pty:exit instead. Stops
    /// a broken `.zshrc` from looping forever.
    pub respawn_history: Arc<Mutex<Vec<Instant>>>,
}

pub type PtyMap = Arc<Mutex<HashMap<String, PtyHandle>>>;

const READ_BUF_SIZE: usize = 256 * 1024;

/// More than RESPAWN_RATE_MAX respawns in this window → stop respawning and
/// surface as a normal exit. A user with a broken shell init file sees the
/// failure mode quickly instead of an infinite spin.
const RESPAWN_RATE_WINDOW: Duration = Duration::from_secs(10);
const RESPAWN_RATE_MAX: usize = 3;

pub enum ReattachResult {
    /// Channel was updated and the reader thread is still running. open_tab
    /// should return false; the reader picks up the new channel on next output.
    ChannelUpdated,
    /// Channel was updated and a new reader thread was spawned (the previous one
    /// had already exited before the reconnect arrived). open_tab returns false.
    Reattached,
    /// Child process has exited — PTY is truly dead. Stale entry removed.
    /// open_tab should spawn a fresh PTY.
    Expired,
    /// No PtyMap entry found. open_tab should spawn a fresh PTY.
    NotFound,
}

/// Bundle of long-lived references the reader thread needs to perform an
/// in-place respawn on shell self-exit. Grouped into a struct so
/// `spawn_reader_thread` doesn't take a 10-param signature.
struct ReaderCtx {
    app: AppHandle,
    tab_id: String,
    channel: SharedChannel,
    mod_handle: ModEngineHandle,
    reader_alive: Arc<AtomicBool>,
    closing: Arc<AtomicBool>,
    pty_map: PtyMap,
    cwd_table: CwdTable,
    /// Per-tab fan-out into local subscribers + sidecar shadow xterm.
    /// Reader threads broadcast every PTY chunk through here; the local
    /// channel above is one of its subscribers (still owned here for the
    /// reconnect-swap mechanism try_reattach uses).
    hub: Arc<StreamHub>,
    /// Fired on respawn_in_place so paired WSS clients push a fresh
    /// Projects frame reflecting the new PtyHandle's state. Optional so
    /// spawn_pty callers that don't yet have a cache (existing tests,
    /// pre-integration paths) can still work.
    projects_cache: Option<Arc<ProjectsCache>>,
}

/// Spawns the reader thread that forwards PTY bytes to the frontend.
///
/// On EOF the thread either emits pty:exit (user-initiated close) or hands
/// off to `respawn_in_place` (shell self-exit). If respawn fails or the rate
/// limit fires, it falls back to pty:exit. See module-level discussion of
/// closing vs self-exit.
fn spawn_reader_thread(
    ctx: ReaderCtx,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUF_SIZE];

        // Stateful UTF-8 decoder. PTY read() can return a chunk that ends in
        // the middle of a multi-byte UTF-8 sequence — common with TUI agents
        // (Claude Code, Codex) that emit dense Unicode. String::from_utf8_lossy
        // would replace those partial bytes with U+FFFD on every chunk
        // boundary, corrupting roughly one character per multi-byte char that
        // lands on a read boundary.
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let mut decoded = String::with_capacity(READ_BUF_SIZE + 4);

        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    // Flush any partial UTF-8 bytes so the tail of the
                    // session output doesn't go missing.
                    decoded.clear();
                    let _ = decoder.decode_to_string(&[], &mut decoded, true);
                    if !decoded.is_empty() {
                        // Decoder tail goes to local subscribers only:
                        // raw bytes are empty here so the ring + sidecar
                        // see nothing (matches the pre-hub flush path).
                        ctx.hub.broadcast(&ctx.tab_id, &[], &decoded);
                    }

                    // Mark dead first so try_reattach can't observe
                    // reader_alive=true on a thread that's already on the
                    // way out.
                    ctx.reader_alive.store(false, Ordering::Release);

                    if ctx.closing.load(Ordering::Acquire) {
                        // User clicked the tab close button. Final cleanup
                        // path: drop the live channel, tell the frontend
                        // and mods, then exit the thread.
                        ctx.channel.lock().unwrap().take();
                        ctx.app.emit(
                            "pty:exit",
                            PtyExitPayload { tab_id: ctx.tab_id.clone() },
                        ).ok();
                        ctx.mod_handle.on_tab_close(&ctx.tab_id);
                        break;
                    }

                    // Shell exited on its own — try to respawn in place at
                    // the last known CWD. Three outcomes:
                    //   * Respawned        → silent exit (new reader took over)
                    //   * SkippedExternally → silent exit (try_reattach already
                    //     reclaimed the entry and open_tab is spawning a fresh
                    //     PTY for this tab id; emitting pty:exit here would
                    //     clobber the new shell's state)
                    //   * Err              → fall through to the user-close path
                    //     (rate limit hit, OS error, etc.)
                    match respawn_in_place(&ctx) {
                        Ok(RespawnOutcome::Respawned)
                        | Ok(RespawnOutcome::SkippedExternally) => break,
                        Err(e) => {
                            eprintln!(
                                "[pty_manager] respawn failed for {}: {e}",
                                ctx.tab_id
                            );
                            ctx.channel.lock().unwrap().take();
                            ctx.app.emit(
                                "pty:exit",
                                PtyExitPayload { tab_id: ctx.tab_id.clone() },
                            ).ok();
                            ctx.mod_handle.on_tab_close(&ctx.tab_id);
                            break;
                        }
                    }
                }
                Ok(n) => {
                    decoded.clear();
                    let (_result, _bytes_read, _had_errors) =
                        decoder.decode_to_string(&buf[..n], &mut decoded, false);

                    // Single fan-out: hub.broadcast handles the local
                    // WebView send (including dead-channel cleanup), the
                    // ring buffer, and the sidecar shadow write. The
                    // PtyDataPayload-shape preservation for the WebView
                    // path is byte-identical to the pre-hub code.
                    ctx.hub.broadcast(&ctx.tab_id, &buf[..n], &decoded);

                    // Mods still see raw bytes directly — the hub is
                    // purely a forwarder for subscribers.
                    ctx.mod_handle.on_output(&ctx.tab_id, buf[..n].to_vec());
                }
            }
        }
    });
}

/// What `respawn_in_place` did, so the reader thread knows whether to stay
/// silent or fall through to the user-close exit path.
enum RespawnOutcome {
    /// Replaced the handle's master/writer/child and started a new reader.
    Respawned,
    /// PtyMap entry was already gone — `try_reattach` reclaimed it and
    /// `open_tab` is spawning a fresh PTY for the same tab id. Emitting
    /// `pty:exit` from here would clobber that new shell's state.
    SkippedExternally,
}

/// Replaces the master/writer/child of an existing PtyHandle with a freshly
/// spawned shell at the last-known CWD, and starts a new reader thread.
///
/// The handle's tab_id, channel, and PtyMap entry stay the same — frontend
/// keeps writing to the same xterm instance and never sees a tab swap.
fn respawn_in_place(ctx: &ReaderCtx) -> Result<RespawnOutcome, String> {
    let mut map = ctx.pty_map.lock().unwrap();
    let Some(handle) = map.get_mut(&ctx.tab_id) else {
        // Race with try_reattach: it called `child.try_wait()`, saw the
        // dead child, removed the entry, and `open_tab` is now spawning a
        // fresh PTY for this tab id. Stay silent — the new spawn owns the
        // tab now.
        return Ok(RespawnOutcome::SkippedExternally);
    };

    // Rate limit: if too many respawns happened recently, surface as a
    // real exit so a broken `.zshrc` doesn't loop the user out of the app.
    let now = Instant::now();
    {
        let mut hist = handle.respawn_history.lock().unwrap();
        hist.retain(|t| now.duration_since(*t) < RESPAWN_RATE_WINDOW);
        if hist.len() >= RESPAWN_RATE_MAX {
            return Err(format!(
                "respawn rate limit exceeded ({} in {}s)",
                hist.len() + 1,
                RESPAWN_RATE_WINDOW.as_secs(),
            ));
        }
        hist.push(now);
    }

    let cwd = ctx
        .cwd_table
        .lock()
        .unwrap()
        .get(&ctx.tab_id)
        .cloned()
        .or_else(|| handle.spawn_cwd.clone())
        .or_else(|| dirs::home_dir().and_then(|p| p.to_str().map(String::from)));

    // Carry the current PTY size across so full-screen apps in the new
    // shell render correctly. Without this the replacement starts at the
    // 80x24 default and stays there until the user manually resizes the
    // pane (xterm doesn't fire a resize when its container size hasn't
    // changed).
    let size = handle
        .master
        .get_size()
        .unwrap_or(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 });

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|e| e.to_string())?;

    let cmd = build_shell_command(&handle.shell_path, cwd.as_deref(), &ctx.tab_id);
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let new_pid = child.process_id().unwrap_or(0);

    let new_reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let new_writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Reset per-tab mod state — the old shell took its agent/process/git
    // observations to the grave. Pretending they still apply would surface
    // lies in the status bar.
    ctx.mod_handle.on_tab_close(&ctx.tab_id);
    ctx.mod_handle.on_tab_open(&ctx.tab_id, new_pid);

    let new_alive = Arc::new(AtomicBool::new(true));
    handle.master = pair.master;
    handle.writer = new_writer;
    handle.child = child;
    handle.reader_alive = new_alive.clone();
    // closing stays whatever it was (false here, since we only respawn on
    // self-exit). Channel arc stays shared so frontend keeps writing into
    // the same xterm.

    drop(map);

    spawn_reader_thread(
        ReaderCtx {
            app: ctx.app.clone(),
            tab_id: ctx.tab_id.clone(),
            channel: ctx.channel.clone(),
            mod_handle: ctx.mod_handle.clone(),
            reader_alive: new_alive,
            closing: ctx.closing.clone(),
            pty_map: ctx.pty_map.clone(),
            cwd_table: ctx.cwd_table.clone(),
            hub: Arc::clone(&ctx.hub),
            projects_cache: ctx.projects_cache.clone(),
        },
        new_reader,
    );

    ctx.app.emit(
        "pty:respawned",
        PtyRespawnPayload {
            tab_id: ctx.tab_id.clone(),
            cwd,
        },
    ).ok();

    // Notify WSS clients so mobile UI's TabState / project tree
    // reflects the new PtyHandle. No-op when the cache hasn't been
    // wired (tests, legacy callers).
    if let Some(cache) = ctx.projects_cache.as_ref() {
        cache.notify_spawn_change();
    }

    Ok(RespawnOutcome::Respawned)
}

pub fn try_reattach(
    app: AppHandle,
    pty_map: &PtyMap,
    mod_handle: ModEngineHandle,
    cwd_table: CwdTable,
    hub: Arc<StreamHub>,
    tab_id: &str,
    on_data: Channel<PtyDataPayload>,
) -> Result<ReattachResult, String> {
    let mut map = pty_map.lock().unwrap();

    let Some(handle) = map.get_mut(tab_id) else {
        return Ok(ReattachResult::NotFound);
    };

    if matches!(handle.child.try_wait(), Ok(Some(_))) {
        // Child fully exited and (somehow) wasn't respawned — stale entry,
        // let the caller spawn a fresh PTY.
        map.remove(tab_id);
        return Ok(ReattachResult::Expired);
    }

    {
        let mut ch = handle.channel.lock().unwrap();
        *ch = Some(on_data);

        // Send the reconnect banner via the data channel, not a Tauri event:
        // the channel's onmessage handler is registered before invoke()
        // resolves, so this send has no listener-timing gap. listen() does.
        if let Some(ch_ref) = ch.as_ref() {
            ch_ref
                .send(PtyDataPayload {
                    data: "\r\n\x1b[2m[Reconnected]\x1b[0m\r\n".to_string(),
                })
                .ok();
        }
    }

    if handle.reader_alive.load(Ordering::Acquire) {
        return Ok(ReattachResult::ChannelUpdated);
    }

    // reader_alive is false but try_wait() didn't confirm exit — the reader
    // set the flag and is in the middle of exiting. Spawn a fresh reader on
    // the same master fd; it'll see EOF immediately and take the normal
    // exit-or-respawn path.
    let new_alive = Arc::new(AtomicBool::new(true));
    handle.reader_alive = new_alive.clone();
    let reader = handle.master.try_clone_reader().map_err(|e| e.to_string())?;
    let channel = handle.channel.clone();
    let closing = handle.closing.clone();
    drop(map);

    spawn_reader_thread(
        ReaderCtx {
            app,
            tab_id: tab_id.to_string(),
            channel,
            mod_handle,
            reader_alive: new_alive,
            closing,
            pty_map: pty_map.clone(),
            cwd_table,
            hub,
            projects_cache: None,
        },
        reader,
    );
    Ok(ReattachResult::Reattached)
}

/// Builds the full shell command (env, args, cwd) used for both the initial
/// spawn and any subsequent respawn. Centralised so respawn picks up the
/// same shell-integration shims, login-shell flags, and AGENT_TERMINAL_TAB_ID
/// injection — without that, the new shell wouldn't emit OSC 7, breaking
/// the next respawn's CWD lookup.
fn build_shell_command(
    shell_path: &str,
    cwd: Option<&str>,
    tab_id: &str,
) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(shell_path);
    cmd.env("AGENT_TERMINAL_TAB_ID", tab_id);
    // Plugin-based agents (opencode) report over HTTP from their own runtime,
    // so they need the hook port at runtime. The shell hook scripts hardcode it
    // at generation time; the plugin reads it from this env var.
    cmd.env("AGENT_TERMINAL_HOOK_PORT", crate::identity::HOOK_PORT.to_string());

    // macOS launchd starts GUI apps with a minimal env (no TERM, no user
    // PATH). Without TERM zsh can't initialize zle and the user sees doubled
    // keystrokes; without user PATH every brewed binary fails with "command
    // not found". TERM is set here; PATH is loaded by the shell itself
    // once we make it a login shell + ZDOTDIR-shim its rc files.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Ok(lang) = std::env::var("LANG") {
        cmd.env("LANG", lang);
    } else {
        cmd.env("LANG", "en_US.UTF-8");
    }

    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    let shell_name = std::path::Path::new(shell_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    if shell_name == "zsh" {
        let at_zsh_dir = dirs::home_dir()
            .map(|h| h.join(".config").join(crate::identity::NAMESPACE).join("zsh"))
            .and_then(|p| p.to_str().map(|s| s.to_string()));

        if let Some(zdotdir) = at_zsh_dir {
            let home = dirs::home_dir()
                .and_then(|h| h.to_str().map(|s| s.to_string()))
                .unwrap_or_default();
            cmd.env("ZDOTDIR", &zdotdir);
            cmd.env("ZDOTDIR_ORIG", &home);
        }

        // Login shell so /etc/zprofile (path_helper) runs and adds the
        // homebrew/system bins to PATH.
        cmd.arg("-l");
    } else if shell_name == "bash" {
        let init_file = dirs::home_dir()
            .map(|h| h.join(".config").join(crate::identity::NAMESPACE).join("bash-integration.bash"))
            .and_then(|p| p.to_str().map(|s| s.to_string()));

        if let Some(init) = init_file {
            cmd.arg("--init-file");
            cmd.arg(&init);
        }
    }

    cmd
}

// Long signature is the trade-off for keeping spawn_pty callable from both
// the open_tab command and the respawn / try_reattach paths without a
// builder. A SpawnConfig struct would be cleaner but is scope creep here.
//
// `on_data` is `Option<Channel<PtyDataPayload>>` so mobile-first spawn (via
// wss_server auto-spawn on Subscribe) can create a PTY with no local
// WebView Channel. The SharedChannel starts as None; when the desktop
// later navigates to the same tab, try_reattach swaps in the WebView's
// Channel and future broadcasts reach both surfaces. Same "reattachable
// local subscriber" shape the hub was designed around.
#[allow(clippy::too_many_arguments)]
pub fn spawn_pty(
    app: AppHandle,
    pty_map: &PtyMap,
    mod_handle: ModEngineHandle,
    cwd_table: CwdTable,
    hub: Arc<StreamHub>,
    projects_cache: Option<Arc<ProjectsCache>>,
    tab_id: String,
    cwd: Option<String>,
    shell: Option<String>,
    on_data: Option<Channel<PtyDataPayload>>,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let shell_path = shell.unwrap_or_else(|| {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    });

    let cmd = build_shell_command(&shell_path, cwd.as_deref(), &tab_id);
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let shell_pid = child.process_id().unwrap_or(0);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // on_open before reader starts, so the engine sees on_open ahead of any
    // on_output from the same tab.
    mod_handle.on_tab_open(&tab_id, shell_pid);

    // Initial value is Some(channel) for desktop-first spawn, None for
    // mobile-first spawn. The hub's Local subscriber slot below still gets
    // wired either way; a None channel is a no-op broadcast target until
    // try_reattach populates it.
    let channel: SharedChannel = Arc::new(Mutex::new(on_data));
    let reader_alive = Arc::new(AtomicBool::new(true));
    let closing = Arc::new(AtomicBool::new(false));
    let respawn_history = Arc::new(Mutex::new(Vec::new()));

    pty_map.lock().unwrap().insert(
        tab_id.clone(),
        PtyHandle {
            master: pair.master,
            writer,
            child,
            reader_alive: reader_alive.clone(),
            channel: channel.clone(),
            closing: closing.clone(),
            shell_path,
            spawn_cwd: cwd,
            respawn_history,
        },
    );

    // Reset any stale hub state for this tab id before wiring the new
    // session. spawn_pty runs when try_reattach returned NotFound or
    // Expired — for Expired, the previous session left a TabState with
    // its own seq counter, ring entries, and (potentially) a
    // disconnected SharedChannel still in the subscriber list. Carrying
    // those into the new PTY would silently leak subscribers and break
    // remote-resume sequence math once remote subscribers exist.
    //
    // close_tab is a no-op for the NotFound case, so this is safe to
    // run unconditionally.
    hub.close_tab(&tab_id);
    hub.ensure_tab(&tab_id, 80, 24);
    hub.subscribe_local(&tab_id, channel.clone());

    spawn_reader_thread(
        ReaderCtx {
            app,
            tab_id,
            channel,
            mod_handle,
            reader_alive,
            closing,
            pty_map: pty_map.clone(),
            cwd_table,
            hub,
            projects_cache,
        },
        reader,
    );

    Ok(())
}

/// Spawn a PTY for `tab_id` only if it is not already in the map. Used
/// by the WSS server when a mobile client subscribes to a sleeping tab
/// (defined in projects.json but no live PtyHandle). Returns true if a
/// new PTY was spawned, false if one was already alive.
///
/// The spawned PTY has no local WebView Channel; broadcasts fan out
/// through the hub to remote subscribers only. When the desktop later
/// navigates to the same tab, `try_reattach` populates the SharedChannel
/// and the desktop terminal takes over rendering seamlessly.
///
/// Runs the same "already-alive but reader thread just died" check
/// `try_reattach` uses so mobile-triggered spawn of an entry-in-transition
/// doesn't race with the reader thread's exit path.
///
/// Concurrent-call safety: two mobile clients subscribing to the same
/// sleeping tab at once would both pass the map check and both call
/// `spawn_pty`, whose unconditional `pty_map.insert` overwrites the
/// first entry — leaking the first child + reader thread. The
/// `SPAWN_GATE` global mutex serialises the check-and-spawn window so
/// only one caller proceeds per tab. Contention is negligible because
/// spawn is a rare, ms-scale operation.
#[allow(clippy::too_many_arguments)]
pub fn spawn_pty_if_absent(
    app: AppHandle,
    pty_map: &PtyMap,
    mod_handle: ModEngineHandle,
    cwd_table: CwdTable,
    hub: Arc<StreamHub>,
    projects_cache: Option<Arc<ProjectsCache>>,
    tab_id: String,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<bool, String> {
    let _spawn_gate = SPAWN_GATE.lock().expect("SPAWN_GATE poisoned");
    {
        let map = pty_map.lock().expect("pty_map lock poisoned");
        if let Some(handle) = map.get(&tab_id) {
            if handle.reader_alive.load(Ordering::Acquire) {
                return Ok(false);
            }
        }
    }
    spawn_pty(
        app,
        pty_map,
        mod_handle,
        cwd_table,
        hub,
        projects_cache,
        tab_id,
        cwd,
        shell,
        None,
    )?;
    Ok(true)
}

/// Serialises concurrent `spawn_pty_if_absent` calls so two mobile
/// clients subscribing to the same sleeping tab_id at once cannot both
/// pass the pty_map check and both spawn. Global rather than per-tab
/// because auto-spawn is rare and the whole operation is ms-scale; the
/// simplicity of one Mutex beats the storage of a per-tab HashMap.
static SPAWN_GATE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
