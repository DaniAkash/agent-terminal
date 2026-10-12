import type {
  AgentTurnState,
  TabMeta,
  TabStatus,
} from '@/modules/stores/$tabMeta'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'
import type { Project, Tab } from '@/screens/workspace/workspace.types'

/** Wire-facing status string shared with `TabSummary.agent_state` in Rust. */
export type SyncAgentState = TabStatus | 'awaiting'

export type SyncTab = Tab & {
  agentState?: SyncAgentState
  agentStateAt?: number
  lastActiveAt?: number
}

export type SyncProject = Omit<Project, 'tabs'> & { tabs: SyncTab[] }

/**
 * Collapse the renderer's two state concepts into the one the wire carries.
 *
 * `agentState` wins when the tab is running an agent, because only it can
 * express "awaiting", the state mobile most needs. `status` is the shell
 * fallback. Mapping lives here rather than at the call site so desktop and
 * mobile cannot drift: this is the single place the translation happens.
 */
export function resolveSyncAgentState(
  meta: TabMeta | undefined,
): SyncAgentState | undefined {
  if (!meta) return undefined
  const turn: AgentTurnState | undefined = meta.agentState
  if (turn === 'awaiting') return 'awaiting'
  if (turn === 'in-progress') return 'running'
  if (turn === 'completed') return 'done'
  return meta.status
}

/**
 * Merge the two renderer-only stores into the tree sent to Rust. Pure so the
 * merge is testable without a Tauri host.
 */
export function buildSyncPayload(
  projects: Project[],
  meta: Record<string, TabMeta>,
  recencyTimes: Record<string, number>,
): SyncProject[] {
  return projects.map((project) => ({
    ...project,
    tabs: project.tabs.map((tab) => {
      const key = makeTabKey(project.id, tab.id)
      const tabMeta = meta[key]
      return {
        ...tab,
        agentState: resolveSyncAgentState(tabMeta),
        agentStateAt: tabMeta?.doneAt,
        lastActiveAt: recencyTimes[key],
      }
    }),
  }))
}
