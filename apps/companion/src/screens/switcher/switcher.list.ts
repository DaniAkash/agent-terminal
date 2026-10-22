import type {
  SessionNode,
  SessionRow,
  SessionView,
  WorkspaceGroup,
} from '@agent-terminal/core-ui'
import { recentSessions, workspaceGroups } from './switcher.helpers'

/**
 * One row of the sheet's list.
 *
 * `FlatList` wants a flat array, and the Workspaces view is a tree, so
 * the tree is flattened into typed items rather than nested into a list
 * inside a list. Nesting scroll containers on a phone is how you get a
 * list that will not scroll.
 */
export type SwitcherItem =
  | { type: 'workspace'; group: WorkspaceGroup }
  | { type: 'session'; node: SessionNode; showProject: boolean; age: boolean }
  | { type: 'empty' }

/**
 * The list behind whichever view is showing.
 *
 * Workspaces draws the tree the sidebar draws: pinned workspaces first,
 * a header per workspace, sessions under it, and a collapsed workspace
 * contributing only its header. Recent draws the flat recency list.
 *
 * Neither view invents an order. Both come from the shared package, so
 * the sheet and the sidebar list the same sessions the same way.
 */
export function switcherItems(
  nodes: SessionNode[],
  view: SessionView,
  collapsed: ReadonlySet<string>,
): SwitcherItem[] {
  if (view === 'recent') {
    const rows = recentSessions(nodes)
    if (rows.length === 0) return [{ type: 'empty' }]
    return rows.map((node: SessionRow) => ({
      type: 'session' as const,
      node,
      // The workspace is not above the row here, so each row names its own.
      showProject: true,
      age: true,
    }))
  }

  const groups = workspaceGroups(nodes)
  if (groups.length === 0) return [{ type: 'empty' }]

  const items: SwitcherItem[] = []
  for (const group of groups) {
    items.push({ type: 'workspace', group })
    // The desktop's own expand state is the default, so a workspace
    // folded on the laptop arrives folded. A local toggle overrides it
    // for this session of the sheet.
    if (isCollapsed(group, collapsed)) continue
    for (const node of group.sessions) {
      items.push({
        type: 'session',
        node,
        // The header directly above already names the workspace.
        showProject: false,
        age: false,
      })
    }
  }
  return items
}

function isCollapsed(
  group: WorkspaceGroup,
  collapsed: ReadonlySet<string>,
): boolean {
  if (collapsed.has(group.projectId)) return true
  return !group.expanded && !collapsed.has(`open:${group.projectId}`)
}

/** Stable `FlatList` key for any item the list can hold. */
export function switcherItemKey(item: SwitcherItem, index: number): string {
  if (item.type === 'workspace') return `workspace:${item.group.projectId}`
  if (item.type === 'empty') return `empty:${index}`
  return `session:${item.node.key}`
}

/**
 * Flip a workspace between folded and open.
 *
 * Two kinds of entry rather than one, because the desktop supplies the
 * default and a toggle has to be able to disagree with it in both
 * directions: `open:<id>` opens one the desktop folded, a bare id folds
 * one the desktop left open.
 */
export function toggleWorkspace(
  collapsed: ReadonlySet<string>,
  group: WorkspaceGroup,
): Set<string> {
  const next = new Set(collapsed)
  const openKey = `open:${group.projectId}`
  if (isCollapsed(group, collapsed)) {
    next.delete(group.projectId)
    next.add(openKey)
  } else {
    next.delete(openKey)
    next.add(group.projectId)
  }
  return next
}
