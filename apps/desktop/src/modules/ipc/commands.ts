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
 * When the tab is closed, IPC.closeTab() removes the pty from the map. The
 * reader thread detects a Channel send error on the next write and exits.
 * Do not rely on GC of the JS closure alone to stop the thread — always call
 * IPC.closeTab() explicitly when tearing down a tab.
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

  saveProjects: (projects: Project[]) =>
    invoke<void>('save_projects', { projects }),

  /**
   * Push the current `$projects` snapshot into the Rust WSS ProjectsCache
   * so mobile clients see it. Fired alongside `saveProjects` on every
   * mutation. Fire-and-forget: any error is a mobile-only feature dropout,
   * never a desktop UI failure.
   *
   * `hydrated` tells Rust that the React `$projects` store is live and
   * ready to receive `wss:mobile_op` events. Bootstrap's initial call
   * from `main.tsx` sets it to true after listProjects() resolves;
   * subsequent per-mutation calls also set true (idempotent). Rust
   * gates all CRUD dispatch on this flag so mobile ops arriving during
   * the cold-start window get a clean OpError instead of a lost event.
   */
  syncProjectsToWss: (projects: Project[], hydrated: boolean) =>
    invoke<void>('sync_projects_to_wss', { projects, hydrated }),

  /**
   * Report a mobile CRUD op failure back to the WSS server. The server
   * routes the resulting OpError frame to the client that fired the op.
   * `connectionId` was supplied in the wss:mobile_op event payload and
   * is required for the compound (connection_id, op_id) inbox key.
   */
  reportMobileOpError: (connectionId: number, opId: number, reason: string) =>
    invoke<void>('report_mobile_op_error', { connectionId, opId, reason }),

  /**
   * Report a mobile CRUD op succeeded back to the WSS server so the
   * originating client's pending promise resolves. Called after the
   * $projects store action returns without throwing.
   */
  reportMobileOpOk: (connectionId: number, opId: number) =>
    invoke<void>('report_mobile_op_ok', { connectionId, opId }),

  listProjects: () => invoke<unknown[]>('list_projects'),
}
