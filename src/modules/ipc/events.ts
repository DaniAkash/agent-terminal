import { listen } from '@tauri-apps/api/event'

// onPtyData has been removed. PTY output is now delivered via a per-tab
// Channel passed to IPC.openTab — no global event bus, no fan-out.

export const onPtyExit = (cb: (tabId: string) => void) =>
  listen<{ tabId: string }>('pty:exit', (e) => cb(e.payload.tabId))

/**
 * Fires after the backend successfully reconnects a live PTY to a new WebView
 * Channel (window close/reopen, HMR reload).
 *
 * Note: the [Reconnected] banner is written directly into the PTY data stream
 * by the Rust backend so it appears without any listen() timing gap. This event
 * is intentionally kept for consumers that need to react to reconnects without
 * rendering text — for example, resetting status-bar state or logging telemetry.
 * TerminalPane does not subscribe to it.
 */
export const onPtyReconnected = (cb: (tabId: string) => void) =>
  listen<{ tabId: string }>('pty:reconnected', (e) => cb(e.payload.tabId))
