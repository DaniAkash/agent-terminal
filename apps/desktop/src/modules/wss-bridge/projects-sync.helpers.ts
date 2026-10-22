import { hasDangerFlag } from '@/components/agent.helpers'
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
  agentId?: string
  fullPermissions?: boolean
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
 * Which agent a tab is running, and whether it was launched with full
 * permissions.
 *
 * Both are needed on the phone to draw the icon the sidebar draws: the id
 * picks the brand mark, the flag decides the 🤘 badge. Neither can be
 * derived from `agentState`, which collapses every tab to one of five
 * status words.
 *
 * The verdict travels, never `agentCmd` itself. An agent command can
 * carry an API key or an absolute home path, and the wire reaches another
 * device over the network, so sending it to answer a yes/no question
 * would be a leak with no upside.
 *
 * Shell tabs report neither field, so a tab that stops being an agent
 * stops claiming an agent rather than keeping the last one it had.
 */
export function resolveSyncAgentIdentity(meta: TabMeta | undefined): {
  agentId?: string
  fullPermissions?: boolean
} {
  if (meta?.type !== 'agent') return {}
  const identity: { agentId?: string; fullPermissions?: boolean } = {
    fullPermissions: hasDangerFlag(meta.agentCmd),
  }
  if (meta.agentId) identity.agentId = meta.agentId
  return identity
}

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
