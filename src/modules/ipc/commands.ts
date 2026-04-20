import { Channel, invoke } from '@tauri-apps/api/core'
import type { Project } from '@/screens/workspace/workspace.types'

export type PtyDataCallback = (data: string) => void

/**
 * Opens a pty for the given tabId and wires a direct Channel for PTY output.
 *
 * Returns true if a new pty was spawned, false if one was already running.
 * The onData callback is called directly by the Channel — no global event bus,
 * no fan-out to other tabs' listeners.
 *
 * The Channel lifetime is tied to the JS closure. When the TerminalPane
 * unmounts (tab closed), the closure is GC'd and the Rust reader thread
 * receives a send error, causing it to exit cleanly.
 */
export function openTab(
  tabId: string,
  cwd: string | undefined,
  onData: PtyDataCallback,
): Promise<boolean> {
  const channel = new Channel<{ data: string }>()
  channel.onmessage = (payload) => onData(payload.data)
  return invoke<boolean>('open_tab', { tabId, cwd, onData: channel })
}

export const IPC = {
  openTab,

  writePty: (tabId: string, data: string) =>
    invoke<void>('write_pty', { tabId, data }),

  resizePty: (tabId: string, cols: number, rows: number) =>
    invoke<void>('resize_pty', { tabId, cols, rows }),

  closeTab: (tabId: string) => invoke<void>('close_tab', { tabId }),

  // Milestone 3: writes to ~/.config/agent-terminal/projects.json
  saveProjects(_: Project[]): void {},

  listProjects: () => invoke<unknown[]>('list_projects'),
}
