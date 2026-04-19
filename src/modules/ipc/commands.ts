import type { Project } from '@/screens/workspace/workspace.types'

// Stub — real Tauri IPC commands wired in PR 3
export const IPC = {
  saveProjects(_: Project[]): void {},
}
