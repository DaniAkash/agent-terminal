import type { WireTabState } from '@agent-terminal/core-ui'
import { tabAgentIdentity, tabWireState } from '@/components/agent.helpers'
import type { TabMeta } from '@/modules/stores/$tabMeta'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'
import type { Project, Tab } from '@/screens/workspace/workspace.types'

/**
 * Wire-facing status string, shared with `TabSummary.agent_state` in
 * Rust and with the glyph derivation in `@agent-terminal/core-ui`.
 */
export type SyncAgentState = WireTabState

export type SyncTab = Tab & {
  agentState?: SyncAgentState
  agentStateAt?: number
  lastActiveAt?: number
  agentId?: string
  fullPermissions?: boolean
}

export type SyncProject = Omit<Project, 'tabs'> & { tabs: SyncTab[] }

/**
 * What the desktop sends for a tab's state.
 *
 * A re-export of the adapter the desktop also DRAWS from, not a parallel
 * implementation. Sending one derivation while rendering another is how
 * two apps end up disagreeing about the same session while each stays
 * internally consistent, so there is deliberately only one.
 */
export const resolveSyncAgentState = tabWireState

/** Likewise for the agent id and the permissions verdict. */
export const resolveSyncAgentIdentity = tabAgentIdentity

export interface AgentStateStamp {
  state: SyncAgentState
  at: number
}

/**
 * Record when each tab's wire state last changed.
 *
 * The renderer has no such timestamp to borrow. `doneAt` marks shell
 * completion and is cleared once the done dot stops lingering, so it can
 * neither describe an `awaiting` turn nor outlive a finished one. Since the
 * wire value is derived here, this is the only place that can see it change.
 *
 * Keys are rebuilt from the tree each pass, so a closed tab's stamp is
 * dropped rather than kept alive. A desktop restart stamps everything with
 * the first sync's clock, the earliest moment it can honestly claim.
 */
export function stampAgentStates(
  projects: Project[],
  meta: Record<string, TabMeta>,
  previous: Record<string, AgentStateStamp>,
  now: number,
): Record<string, AgentStateStamp> {
  const next: Record<string, AgentStateStamp> = {}
  for (const project of projects) {
    for (const tab of project.tabs) {
      const key = makeTabKey(project.id, tab.id)
      const state = resolveSyncAgentState(meta[key])
      if (state === undefined) continue
      const prior = previous[key]
      next[key] = prior?.state === state ? prior : { state, at: now }
    }
  }
  return next
}

/**
 * Merge the renderer-only stores into the tree sent to Rust. Pure so the
 * merge is testable without a Tauri host.
 */
export function buildSyncPayload(
  projects: Project[],
  meta: Record<string, TabMeta>,
  recencyTimes: Record<string, number>,
  agentStateStamps: Record<string, AgentStateStamp>,
): SyncProject[] {
  return projects.map((project) => ({
    ...project,
    tabs: project.tabs.map((tab) => {
      const key = makeTabKey(project.id, tab.id)
      const tabMeta = meta[key]
      return {
        ...tab,
        agentState: resolveSyncAgentState(tabMeta),
        agentStateAt: agentStateStamps[key]?.at,
        lastActiveAt: recencyTimes[key],
        ...resolveSyncAgentIdentity(tabMeta),
      }
    }),
  }))
}
