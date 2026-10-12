import { recencyOrder } from '@/modules/stores/$recency.helpers'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import { rawTabId } from '@/screens/tab/tab.helpers'
import { sessionLabel } from '@/screens/tab/tab-label.helpers'
import { type TabGlyph, tabGlyph } from '@/screens/tab/tab-status.helpers'

/**
 * Why a session is where it is in the list. The order is the whole point
 * of the sheet, so the reason is part of the data rather than something
 * the view infers.
 */
export type SwitcherSection = 'attention' | 'recent' | 'idle'

export interface SwitcherRow {
  /** Composed wire id: unique across projects, and what routes address. */
  key: string
  projectId: string
  /** Raw id, for building the route. */
  tabId: string
  label: string
  projectName: string
  glyph: TabGlyph
  section: SwitcherSection
  lastActiveAt: number | undefined
}

/**
 * Order the sessions the way the phone should read them.
 *
 * Attention first, then most-recently-used, then everything never opened.
 * The first group is the reason the sheet exists: a turn waiting on an
 * answer is the one thing worth interrupting someone for, so it outranks
 * recency no matter how long ago it was touched.
 *
 * Ordering spans projects on purpose. The desktop keys recency by project
 * and tab together, so history crosses workspace boundaries rather than
 * being trapped inside the one you happen to be in.
 */
export function switcherOrder(
  projects: ProjectSummary[],
  now: number,
): SwitcherRow[] {
  const names = new Map(projects.map((p) => [p.project_id, p.name]))
  const tabs = new Map(
    projects.flatMap((p) => p.tabs.map((t) => [t.tab_id, t] as const)),
  )

  const rows = recencyOrder(projects).map((entry): SwitcherRow => {
    const tab = tabs.get(entry.key)
    const glyph = tabGlyph(tab?.agent_state, tab?.agent_state_at, now)
    return {
      key: entry.key,
      projectId: entry.projectId,
      tabId: rawTabId(entry.projectId, entry.key),
      label: tab ? sessionLabel(tab) : entry.tabId,
      projectName: names.get(entry.projectId) ?? '',
      glyph,
      section: sectionFor(glyph, entry.lastActiveAt),
      lastActiveAt: entry.lastActiveAt,
    }
  })

  // recencyOrder already sorted by last-active; a stable partition keeps
  // that order inside each group rather than re-sorting it away.
  return [
    ...rows.filter((r) => r.section === 'attention'),
    ...rows.filter((r) => r.section === 'recent'),
    ...rows.filter((r) => r.section === 'idle'),
  ]
}

function sectionFor(
  glyph: TabGlyph,
  lastActiveAt: number | undefined,
): SwitcherSection {
  if (glyph === 'awaiting') return 'attention'
  return lastActiveAt === undefined ? 'idle' : 'recent'
}

/** Heading above each group, or null where the group speaks for itself. */
export function sectionHeading(section: SwitcherSection): string {
  if (section === 'attention') return 'Needs you'
  if (section === 'recent') return 'Recent'
  return 'Not opened yet'
}

/**
 * Compact age for a row. Deliberately coarse: the useful question is
 * "minutes or days", never the exact second.
 */
export function relativeAge(
  lastActiveAt: number | undefined,
  now: number,
): string {
  if (lastActiveAt === undefined) return ''
  const seconds = Math.floor((now - lastActiveAt) / 1000)
  if (seconds < 45) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${Math.max(minutes, 1)}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/**
 * The section heading to draw above a row, or null where the row sits
 * inside a group that has already been labelled.
 */
export function headingAt(
  rows: readonly SwitcherRow[],
  index: number,
): SwitcherSection | null {
  const section = rows[index]?.section
  if (section === undefined) return null
  if (index === 0) return section
  return rows[index - 1]?.section === section ? null : section
}
