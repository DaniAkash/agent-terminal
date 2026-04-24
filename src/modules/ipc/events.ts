import { listen } from '@tauri-apps/api/event'

// onPtyData has been removed. PTY output is now delivered via a per-tab
// Channel passed to IPC.openTab — no global event bus, no fan-out.

export const onPtyExit = (cb: (tabId: string) => void) =>
  listen<{ tabId: string }>('pty:exit', (e) => cb(e.payload.tabId))

/**
 * Fires when a dead reader thread is successfully reattached to a live PTY.
 *
 * This happens when the WebView restarts (window close/reopen, HMR reload)
 * and the frontend calls openTab for a tab whose PTY process is still running.
 * The Rust backend spins up a new reader thread on the existing PTY master fd
 * and emits this event before any buffered output flows through.
 *
 * Limitation: output that the old reader thread read but could not send before
 * the channel dropped is gone. Output written by the PTY process after the
 * disconnect but still in the kernel PTY buffer may be delivered, but replay
 * of earlier history is not supported.
 */
export const onPtyReconnected = (cb: (tabId: string) => void) =>
  listen<{ tabId: string }>('pty:reconnected', (e) => cb(e.payload.tabId))
