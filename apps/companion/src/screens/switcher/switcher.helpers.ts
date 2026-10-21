import type { DeviceSessionsMap } from '@/modules/stores/$deviceSessions.helpers'
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

/** The minimal shape `switcherGroups` needs from a paired device record. */
export interface SwitcherDevice {
  deviceId: string
  deviceHint: string
}

export interface DeviceGroup {
  deviceId: string
  deviceName: string
  /** True only for the desktop currently driving the socket. */
  connected: boolean
  /** When this group's tree was last known good; null if never synced. */
  syncedAt: number | null
  rows: SwitcherRow[]
}

/**
 * One row list per paired desktop instead of one for whichever desktop
 * happens to be driving the socket, so switching the active desktop stops
 * hiding every other paired desktop's sessions. The active desktop's
 * group uses its live tree; every other paired desktop falls back to
 * whatever was last cached for it (`$deviceSessions`), which is stale but
 * still useful — most of a session tree does not change between opens.
 */
export function switcherGroups(
  devices: readonly SwitcherDevice[],
  activeDeviceId: string | null,
  activeConnected: boolean,
  liveProjects: ProjectSummary[],
  cache: DeviceSessionsMap,
  now: number,
): DeviceGroup[] {
  const groups = devices.map((device): DeviceGroup => {
    const isActive = device.deviceId === activeDeviceId
    const cached = cache[device.deviceId]
    const connected = isActive && activeConnected
    return {
      deviceId: device.deviceId,
      deviceName: device.deviceHint,
      connected,
      syncedAt: connected ? now : (cached?.syncedAt ?? null),
      rows: switcherOrder(
        isActive ? liveProjects : (cached?.projects ?? []),
        now,
      ),
    }
  })
  // The driven desktop reads first: it is the one just connected to, its
  // tree is guaranteed fresh, and it is the likeliest answer to "what was
  // I just doing".
  return [
    ...groups.filter((g) => g.deviceId === activeDeviceId),
    ...groups.filter((g) => g.deviceId !== activeDeviceId),
  ]
}

export type SwitcherListItem =
  | { type: 'device'; group: DeviceGroup }
  | { type: 'heading'; deviceId: string; section: SwitcherSection }
  | { type: 'row'; deviceId: string; row: SwitcherRow }
  | { type: 'empty'; deviceId: string }

/**
 * Turns device groups into the single flat array `FlatList` renders —
 * a device header, then its sections, skipped entirely while collapsed.
 */
export function flattenGroups(
  groups: readonly DeviceGroup[],
  collapsed: ReadonlySet<string>,
): SwitcherListItem[] {
  const items: SwitcherListItem[] = []
  for (const group of groups) {
    items.push({ type: 'device', group })
    if (collapsed.has(group.deviceId)) continue
    if (group.rows.length === 0) {
      items.push({ type: 'empty', deviceId: group.deviceId })
      continue
    }
    group.rows.forEach((row, index) => {
      const heading = headingAt(group.rows, index)
      if (heading !== null) {
        items.push({
          type: 'heading',
          deviceId: group.deviceId,
          section: heading,
        })
      }
      items.push({ type: 'row', deviceId: group.deviceId, row })
    })
  }
  return items
}

/**
 * Stable `FlatList` key for any item `flattenGroups` produces.
 *
 * Every key is device-scoped, including rows: `row.key` is only unique
 * within one desktop's tree, and desktop ids are assigned independently
 * of each other, so two paired desktops can hand back the same
 * project/tab id. Without the device prefix that collision would make
 * `FlatList` drop or misrender a row the moment two desktops disagree.
 */
export function switcherListItemKey(item: SwitcherListItem): string {
  if (item.type === 'device') return `device:${item.group.deviceId}`
  if (item.type === 'heading') return `heading:${item.deviceId}:${item.section}`
  if (item.type === 'empty') return `empty:${item.deviceId}`
  return `row:${item.deviceId}:${item.row.key}`
}
