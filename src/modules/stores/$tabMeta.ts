import { atom, computed, type ReadableAtom } from 'nanostores'

export type TabStatus = 'idle' | 'running' | 'done' | 'error'
export type TabType = 'shell' | 'task' | 'agent'

/**
 * Rich agent turn state — driven by hook events from AgentTurnMod.
 * Matches the AgentState type in agent.helpers.ts so deriveAgentState can
 * return it directly: `if (meta.agentState) return meta.agentState`.
 */
export type AgentTurnState = 'idle' | 'in-progress' | 'awaiting' | 'completed'

export type GitInfo = {
  branch: string
  aheadBy: number
  behindBy: number
  isDirty: boolean
  worktree?: string
  pr?: { number: number; title: string; state: string; url: string }
}

/**
 * A single process entry as emitted by ProcessInspectorMod.
 * Mirrors the Rust `ProcessEntry` struct serialised over IPC.
 *
 * Note: `cpuPercent` is a sysinfo lifetime average — not a real-time sample.
 * Do not display it in the UI; it is intentionally omitted here.
 */
export type ProcessInfo = {
  pid: number
  name: string
  /** Full command string including args (from `ps -o args=`). */
  command: string
  /** Resident memory in kilobytes (from sysinfo). */
  memoryKb: number
  /** Elapsed wall-clock time formatted as `mm:ss` or `h:mm:ss` or `d-hh:mm`. */
  elapsedTime: string
  /** TCP ports this process is listening on (from lsof). */
  listeningPorts: number[]
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
  /** Agent binary name: "claude-code" | "codex" — set when type is "agent". */
  agentName?: string
  /** Full command used to launch the agent — set by ClaudeCodeMod / CodexMod. */
  agentCmd?: string
  /**
   * Live process list for this tab — set by ProcessInspectorMod every 2s.
   * Only agent processes (claude, codex) that are direct children of the
   * tab's shell PID are included. Empty for shell-only tabs.
   */
  processes?: ProcessInfo[]
  /**
   * Convenience: TCP ports across all tracked processes.
   * Derived from `processes` in the mod-listener; kept for backwards compat.
   */
  listeningPorts?: number[]
  /**
   * Rich agent turn state — set by AgentTurnMod via hook events.
   * `undefined` means no hook data has arrived yet; deriveAgentState falls
   * back to OSC 133-based heuristics in that case.
   */
  agentState?: AgentTurnState
  /**
   * Optional message associated with the current agentState.
   * `awaiting`: the question or permission text the agent needs answered.
   * `completed`: the last assistant message (truncated to ~200 chars).
   */
  agentMessage?: string
}

const defaultMeta: TabMeta = { status: 'idle', type: 'shell' }

/**
 * Ephemeral runtime metadata for each terminal tab, keyed by tabKey
 * (the `${projectId}:${tabId}` string produced by `makeTabKey`).
 *
 * This store is never persisted — MODs recompute all values from scratch when
 * a tab is opened. Keeping it separate from `$projects` means persisted user
 * configuration and live runtime state never mix.
 */
export const $tabMeta = atom<Record<string, TabMeta>>({})

export function updateTabMeta(tabKey: string, patch: Partial<TabMeta>): void {
  const cur = $tabMeta.get()
  const next = { ...defaultMeta, ...cur[tabKey], ...patch }
  if (JSON.stringify(cur[tabKey]) === JSON.stringify(next)) return
  $tabMeta.set({ ...cur, [tabKey]: next })
}

export function clearTabMeta(tabKey: string): void {
  const cur = $tabMeta.get()
  const next = { ...cur }
  delete next[tabKey]
  $tabMeta.set(next)
  isAgentAtomCache.delete(tabKey)
}

const isAgentAtomCache = new Map<string, ReadableAtom<boolean>>()

/**
 * Per-tab derived store of `meta.type === 'agent'`. Subscribers re-render
 * only when this tab's `type` flips, not on every $tabMeta update — important
 * for components mounted across many tabs (e.g. TerminalPane is kept mounted
 * for every visited tab while ProcessInspectorMod writes to $tabMeta every 2s).
 */
export function $isAgentForTab(tabKey: string): ReadableAtom<boolean> {
  let store = isAgentAtomCache.get(tabKey)
  if (!store) {
    store = computed($tabMeta, (all) => all[tabKey]?.type === 'agent')
    isAgentAtomCache.set(tabKey, store)
  }
  return store
}
