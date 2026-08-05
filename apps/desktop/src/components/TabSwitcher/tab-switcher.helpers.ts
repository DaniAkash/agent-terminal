import {
  makeTabKey,
  resolveTabLabel,
} from '@/screens/workspace/workspace.helpers'
import type { Project } from '@/screens/workspace/workspace.types'

/* ---------------------------------------------------------------------------
 * Pure helpers for the Cmd+P tab switcher. No React, no stores — easy to
 * unit-test, easy to reuse if another surface ever wants a flat tab view.
 * -------------------------------------------------------------------------*/

export type SwitcherRow = {
  tabKey: string
  projectId: string
  projectName: string
  tabId: string
  /**
   * Display label — already resolved through `resolveTabLabel` (same logic
   * the sidebar uses), so a user-renamed tab keeps its label, an
   * un-renamed tab with a known cwd shows the cwd basename, and the raw
   * stored label is the fallback. Identical between sidebar and palette
   * by construction.
   */
  label: string
  cwd?: string
  /**
   * 1-based recency rank. No cap — the palette shows the full position
   * for every visited tab so the user can see "ah, that was 27 switches
   * ago." Zero means the tab has never been visited in the tracked window.
   */
  rank: number
  lastActiveAt: number | undefined
  isCurrent: boolean
}

/**
 * Build the ordered row list:
 *   1. Tabs in recency order (most recent first), each annotated with its
 *      full uncapped rank
 *   2. Tabs never visited in the tracked window, appended in project +
 *      sidebar order, with rank 0
 *
 * Stale recency entries (no matching tab in `projects`) are dropped — they
 * can appear after a tab is closed if cleanup didn't fire, or when restored
 * from a previous session that had different tabs.
 */
export function buildSwitcherRows(args: {
  projects: Project[]
  recency: string[]
  recencyTimes: Record<string, number>
  tabMeta: Record<string, { cwd?: string }>
  activeProjectId: string
  activeTabIds: Record<string, string>
}): SwitcherRow[] {
  const allTabs = new Map<
    string,
    { project: Project; tabId: string; label: string }
  >()
  for (const p of args.projects) {
    for (const t of p.tabs) {
      const key = makeTabKey(p.id, t.id)
      // Resolve the display label HERE so every render site (sidebar,
      // palette, future surfaces) shows the same string for the same
      // tab. Sidebar pulls from $tabMeta via resolveTabLabel; we do the
      // same with the meta we already have.
      const displayLabel = resolveTabLabel(t, args.tabMeta[key]?.cwd)
      allTabs.set(key, {
        project: p,
        tabId: t.id,
        label: displayLabel,
      })
    }
  }

  const activeTabIdForProject = args.activeTabIds[args.activeProjectId]
  const activeKey = activeTabIdForProject
    ? makeTabKey(args.activeProjectId, activeTabIdForProject)
    : ''

  const seen = new Set<string>()
  const rows: SwitcherRow[] = []

  args.recency.forEach((key, idx) => {
    const t = allTabs.get(key)
    if (!t) return
    seen.add(key)
    rows.push({
      tabKey: key,
      projectId: t.project.id,
      projectName: t.project.name,
      tabId: t.tabId,
      label: t.label,
      cwd: args.tabMeta[key]?.cwd,
      rank: idx + 1,
      lastActiveAt: args.recencyTimes[key],
      isCurrent: key === activeKey,
    })
  })

  for (const p of args.projects) {
    for (const t of p.tabs) {
      const key = makeTabKey(p.id, t.id)
      if (seen.has(key)) continue
      rows.push({
        tabKey: key,
        projectId: p.id,
        projectName: p.name,
        tabId: t.id,
        label: t.label,
        cwd: args.tabMeta[key]?.cwd,
        rank: 0,
        lastActiveAt: undefined,
        isCurrent: key === activeKey,
      })
    }
  }

  return rows
}

/**
 * Substring filter across label + projectName + cwd. Preserves the input
 * row order so recency ranking is maintained among matches.
 *
 * Case-insensitive. Empty query returns the input array unchanged (same
 * reference — callers can rely on this for memoisation).
 */
export function filterSwitcherRows(
  rows: SwitcherRow[],
  query: string,
): SwitcherRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => {
    const hay = `${r.label} ${r.projectName} ${r.cwd ?? ''}`.toLowerCase()
    return hay.includes(q)
  })
}

/**
 * Compact relative-time string for the palette metadata line.
 *
 *   undefined            → 'never'
 *   < 10s                → 'just now'
 *   < 60s                → 'Ns ago'
 *   < 60min              → 'Nm ago'
 *   < 24h                → 'Nh ago'
 *   1 day                → 'yesterday'
 *   < 7 days             → 'Nd ago'
 *   < 30 days            → 'Nw ago'
 *   otherwise            → 'Nmo ago'
 */
export function formatRelativeTime(
  now: number,
  then: number | undefined,
): string {
  if (then === undefined) return 'never'
  const diffMs = Math.max(0, now - then)
  const sec = Math.floor(diffMs / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}
