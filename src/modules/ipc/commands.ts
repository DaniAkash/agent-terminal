import { invoke } from '@tauri-apps/api/core'
import type { Project } from '@/screens/workspace/workspace.types'

export const IPC = {
  // Milestone 3: writes to ~/.config/agent-terminal/projects.json
  saveProjects(_: Project[]): void {},

  openTab: (tabId: string, cwd?: string, shell?: string) =>
    invoke<void>('open_tab', { tabId, cwd, shell }),

  writePty: (tabId: string, data: string) =>
    invoke<void>('write_pty', { tabId, data }),

  resizePty: (tabId: string, cols: number, rows: number) =>
    invoke<void>('resize_pty', { tabId, cols, rows }),

  closeTab: (tabId: string) => invoke<void>('close_tab', { tabId }),

  listProjects: () => invoke<unknown[]>('list_projects'),
}
