import { atom } from 'nanostores'

export type TabStatus = 'idle' | 'running' | 'done' | 'error'
export type TabType = 'shell' | 'task' | 'agent'

export type GitInfo = {
  branch: string
  aheadBy: number
  behindBy: number
  isDirty: boolean
  worktree?: string
  pr?: { number: number; title: string; state: string; url: string }
}

export type ClaudeSession = {
  sessionId: string
  gitBranch?: string
  model?: string
  permissionMode?: string
  title?: string
  prNumber?: number
  prUrl?: string
}

export type CodexSession = {
  sessionId: string
  gitBranch?: string
  model?: string
  approvalPolicy?: string
  sandboxMode?: string
  effort?: string
  title?: string
}

export type TabMeta = {
  /** Shell or agent process state — driven by ProcessTrackerMod (OSC 133). */
  status: TabStatus
  /** Tab classification — set by ClaudeCodeMod / CodexMod. */
  type: TabType
  /** Current working directory — set by DirTrackerMod (OSC 7). */
  cwd?: string
  /** Git context — set by GitMonitorMod. */
  git?: GitInfo
  /** Non-zero exit code when status is "error". */
  exitCode?: number
  /** Agent binary name: "claude-code" | "codex". */
  agentName?: string
  /** Active Claude Code session metadata — set by ClaudeCodeMod. */
  claudeSession?: ClaudeSession
  /** Active Codex session metadata — set by CodexMod. */
  codexSession?: CodexSession
  /** TCP ports the agent process tree is listening on — set by ProcessInspectorMod. */
  listeningPorts?: number[]
}

const defaultMeta: TabMeta = { status: 'idle', type: 'shell' }

/**
 * Ephemeral runtime metadata for each terminal tab, keyed by tabId.
 *
 * This store is never persisted — MODs recompute all values from scratch when
 * a tab is opened. Keeping it separate from `$projects` means persisted user
 * configuration and live runtime state never mix.
 */
export const $tabMeta = atom<Record<string, TabMeta>>({})

export function updateTabMeta(tabId: string, patch: Partial<TabMeta>): void {
  const cur = $tabMeta.get()
  $tabMeta.set({
    ...cur,
    [tabId]: { ...defaultMeta, ...cur[tabId], ...patch },
  })
}

export function clearTabMeta(tabId: string): void {
  const cur = $tabMeta.get()
  const next = { ...cur }
  delete next[tabId]
  $tabMeta.set(next)
}
