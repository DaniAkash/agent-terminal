import type { SwitcherRow } from '@/components/TabSwitcher/tab-switcher.helpers'

/**
 * Row shape rendered by SidebarRecent. Deliberately narrower than
 * `SwitcherRow`:
 *   - `rank` and `lastActiveAt` are dropped, the sidebar does not
 *     render rank digits or timestamps.
 *   - `cwd` is dropped, the sidebar row is single-line label + TabChip.
 *   - `projectName` is kept as a separate field so the hover Tooltip
 *     can render it independently from the row body.
 */
export type SidebarRecentRow = {
  tabKey: string
  projectId: string
  tabId: string
  label: string
  projectName: string
  isCurrent: boolean
}

/**
 * Trims the Cmd+P `SwitcherRow` output down to what the sidebar's
 * Recent view actually renders.
 *
 * Also filters to `rank > 0`, only tabs the user has visited during
 * the tracked window. Tabs the user has never touched clutter the
 * Recent view (defeats its purpose as a "what was I just doing"
 * surface). Cmd+P still shows every tab because search needs full
 * coverage; the sidebar's Recent view has a different job.
 */
export function toRecentSidebarRows(rows: SwitcherRow[]): SidebarRecentRow[] {
  return rows
    .filter((row) => row.rank > 0)
    .map((row) => ({
      tabKey: row.tabKey,
      projectId: row.projectId,
      tabId: row.tabId,
      label: row.label,
      projectName: row.projectName,
      isCurrent: row.isCurrent,
    }))
}
