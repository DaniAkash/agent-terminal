import type { SessionNode, SessionRow, WorkspaceGroup } from './session.types'

/**
 * Most-recently-used first, with never-opened sessions last in tree
 * order.
 *
 * Sorting by timestamp rather than by position in a maintained list is
 * deliberate. The desktop held an explicit MRU array and ranked by index;
 * the phone only ever had the timestamps. Two implementations that agree
 * most of the time are worse than one, and the timestamp is the half both
 * devices can see, so it is the half that wins.
 *
 * Ordering crosses workspaces on purpose. Recency is keyed by project and
 * tab together on both sides, so moving back through history leaves the
 * workspace you happen to be in rather than being trapped inside it.
 */
export function orderByRecency(nodes: readonly SessionNode[]): SessionRow[] {
  const ordered = nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const at = a.node.lastActiveAt
      const bt = b.node.lastActiveAt
      // Tree order breaks every tie, so the sequence is stable rather
      // than at the mercy of the sort's implementation.
      if (at === undefined && bt === undefined) return a.index - b.index
      if (at === undefined) return 1
      if (bt === undefined) return -1
      if (at === bt) return a.index - b.index
      return bt - at
    })

  let rank = 0
  return ordered.map(({ node }) => ({
    ...node,
    // Rank counts only sessions actually visited, so an unvisited one
    // reads as zero rather than as "last place", which is a different
    // claim.
    rank: node.lastActiveAt === undefined ? 0 : ++rank,
  }))
}

/**
 * The recency list as a surface showing "what was I just doing" wants it:
 * sessions never opened are dropped.
 *
 * They are not noise everywhere. The command palette keeps them because
 * search needs full coverage. A recency list that includes things with no
 * recency is just the tree in a worse order.
 */
export function toRecentRows(rows: readonly SessionRow[]): SessionRow[] {
  return rows.filter((row) => row.rank > 0)
}

/**
 * The tree, in display order: pinned workspaces first, pinned sessions
 * first inside each.
 *
 * Workspace order follows the order nodes arrive in, which is the order
 * the user arranged, so dragging a workspace in the sidebar moves it on
 * the phone too.
 */
export function groupByWorkspace(
  nodes: readonly SessionNode[],
): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>()

  for (const node of nodes) {
    const existing = groups.get(node.projectId)
    if (existing) {
      existing.sessions.push(node)
      continue
    }
    groups.set(node.projectId, {
      projectId: node.projectId,
      projectName: node.projectName,
      pinned: node.projectPinned,
      expanded: node.projectExpanded,
      position: 0,
      sessions: [node],
    })
  }

  const ordered = [
    ...[...groups.values()].filter((g) => g.pinned),
    ...[...groups.values()].filter((g) => !g.pinned),
  ]

  return ordered.map((group, index) => ({
    ...group,
    // 1-based, matching the desktop's Cmd+N numbering.
    position: index + 1,
    sessions: [
      ...group.sessions.filter((s) => s.pinned),
      ...group.sessions.filter((s) => !s.pinned),
    ],
  }))
}

/**
 * Compact age for a row. Deliberately coarse: the useful question is
 * "minutes or days", never the exact second.
 *
 * Two formatters sit on top of this, one per surface, because the
 * desktop palette has room for "4m ago" and "yesterday" while the phone
 * has a narrow right-aligned column that wants "4m". Sharing the
 * arithmetic and not the wording is the right seam; forcing one string
 * on both would make one of them worse.
 */
export function ageBuckets(
  now: number,
  then: number | undefined,
): { seconds: number; minutes: number; hours: number; days: number } | null {
  if (then === undefined) return null
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  return { seconds, minutes, hours, days: Math.floor(hours / 24) }
}
