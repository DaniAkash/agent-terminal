import { listen } from '@tauri-apps/api/event'

// onPtyData has been removed. PTY output is now delivered via a per-tab
// Channel passed to IPC.openTab — no global event bus, no fan-out.

export const onPtyExit = (cb: (tabId: string) => void) =>
  listen<{ tabId: string }>('pty:exit', (e) => cb(e.payload.tabId))
