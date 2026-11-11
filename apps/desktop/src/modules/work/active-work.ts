import type { TabMeta } from '@/modules/stores/$tabMeta'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'
import type { Project } from '@/screens/workspace/workspace.types'

/**
 * Whether a tab is doing something the user would mind losing.
 *
 * One reader for all three confirmations (quit, close tab, restart after
 * an update) so they cannot disagree about what counts as busy.
 *
 * `awaiting` is in here deliberately. An agent sitting on a question
 * burns no CPU, so a plain "is a process alive" test misses it, yet
 * closing that tab throws away the question the agent is blocked on,
 * which is the more annoying of the two losses.
 */
export type WorkReason = 'running' | 'awaiting'

export interface ActiveWork {
  projectId: string
  projectName: string
  tabId: string
  tabLabel: string
  reason: WorkReason
  /** What is running, or who is waiting. */
  detail: string
  /** How long it has been going, when a tracked process reports it. */
  elapsed?: string
}

/** Keeps one pathological command from pushing the buttons off screen. */
const DETAIL_LIMIT = 120

export function workReason(meta: TabMeta | undefined): WorkReason | null {
  if (!meta) return null
  if (meta.agentState === 'awaiting') return 'awaiting'
  if (meta.agentState === 'in-progress') return 'running'
  if (meta.nestedShellIdle) return null
  if (meta.processes && meta.processes.length > 0) return 'running'
  if (meta.status === 'running') return 'running'
  return null
}

export function describeWork(meta: TabMeta, reason: WorkReason): string {
  const agent = meta.agentDisplayName ?? 'agent'
  if (reason === 'awaiting') return `${agent}, waiting on your answer`
  if (meta.agentState === 'in-progress') return `${agent}, turn in flight`
  const proc = meta.processes?.[0]
  if (proc) return truncate(proc.command || proc.name)
  return 'running a command'
}

function truncate(text: string): string {
  return text.length > DETAIL_LIMIT
    ? `${text.slice(0, DETAIL_LIMIT - 1)}…`
    : text
}

function toActiveWork(
  project: Project,
  tabId: string,
  tabLabel: string,
  meta: TabMeta,
  reason: WorkReason,
): ActiveWork {
  return {
    projectId: project.id,
    projectName: project.name,
    tabId,
    tabLabel,
    reason,
    detail: describeWork(meta, reason),
    elapsed: meta.processes?.[0]?.elapsedTime,
  }
}

export function activeWorkForTab(
  project: Project,
  tabId: string,
  tabMeta: Readonly<Record<string, TabMeta>>,
): ActiveWork | null {
  const tab = project.tabs.find((t) => t.id === tabId)
  if (!tab) return null
  const meta = tabMeta[makeTabKey(project.id, tabId)]
  const reason = workReason(meta)
  if (!reason || !meta) return null
  return toActiveWork(project, tabId, tab.label, meta, reason)
}

/** Every busy tab across every project, in sidebar order. */
export function collectActiveWork(
  projects: readonly Project[],
  tabMeta: Readonly<Record<string, TabMeta>>,
): ActiveWork[] {
  const found: ActiveWork[] = []
  for (const project of projects) {
    for (const tab of project.tabs) {
      const meta = tabMeta[makeTabKey(project.id, tab.id)]
      const reason = workReason(meta)
      if (reason && meta) {
        found.push(toActiveWork(project, tab.id, tab.label, meta, reason))
      }
    }
  }
  return found
}
