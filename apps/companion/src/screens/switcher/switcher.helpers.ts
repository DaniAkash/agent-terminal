import {
  ageBuckets,
  groupByWorkspace,
  orderByRecency,
  rawTabId,
  type SessionNode,
  type SessionRow,
  toRecentRows,
  type WorkspaceGroup,
} from '@agent-terminal/core-ui'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import { sessionLabel } from '@/screens/tab/tab-label.helpers'
import { tabVisualFor } from '@/screens/tab/tab-status.helpers'

/**
 * The phone's adapter onto the shared session model.
 *
 * One `ProjectSummary[]` holds everything, where the desktop spreads the
 * same facts across three stores. Flattening it here is all this app has
 * to do: the ordering and grouping above this line are the functions the
 * sidebar runs.
 */
export function toSessionNodes(
  projects: readonly ProjectSummary[],
  currentKey: string | undefined,
  now: number,
): SessionNode[] {
  const nodes: SessionNode[] = []
  for (const project of projects) {
    for (const tab of project.tabs) {
      const isCurrent = tab.tab_id === currentKey
      nodes.push({
        // Already composed by Rust; passing it through makeTabKey again
        // would yield `p1:p1:claude`, matching no route and no desktop key.
        key: tab.tab_id,
        projectId: project.project_id,
        projectName: project.name,
        projectPinned: project.pinned ?? false,
        projectExpanded: project.is_expanded,
        tabId: rawTabId(project.project_id, tab.tab_id),
        label: sessionLabel(tab),
        pinned: tab.pinned ?? false,
        lastActiveAt: tab.last_active_at,
        isCurrent,
        visual: tabVisualFor(tab, now, isCurrent),
      })
    }
  }
  return nodes
}

/** The flat recency list, with sessions never opened dropped. */
export function recentSessions(nodes: SessionNode[]): SessionRow[] {
  return toRecentRows(orderByRecency(nodes))
}

/** The workspace tree, pinned first, exactly as the sidebar orders it. */
export function workspaceGroups(nodes: SessionNode[]): WorkspaceGroup[] {
  return groupByWorkspace(nodes)
}

/**
 * Compact age for a row. Deliberately coarse: the useful question is
 * "minutes or days", never the exact second.
 *
 * Shorter wording than the desktop palette's, because this sits in a
 * narrow right-aligned column. The arithmetic behind both is shared.
 */
export function relativeAge(
  lastActiveAt: number | undefined,
  now: number,
): string {
  const age = ageBuckets(now, lastActiveAt)
  if (age === null) return ''
  if (age.seconds < 45) return 'now'
  if (age.minutes < 60) return `${Math.max(age.minutes, 1)}m`
  if (age.hours < 24) return `${age.hours}h`
  return `${age.days}d`
}

/**
 * The age as a screen reader should hear it.
 *
 * The column reads as a duration, so it needs "ago" after it, except for
 * "now", where appending produced "now ago".
 */
export function spokenAge(age: string): string {
  if (age === '') return ''
  if (age === 'now') return ', just now'
  return `, ${age} ago`
}
