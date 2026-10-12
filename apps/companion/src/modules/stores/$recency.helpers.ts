import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import { rawTabId } from '@/screens/tab/tab.helpers'

/**
 * Mirrors the desktop's `makeTabKey`, for the callers holding a raw tab id.
 *
 * Note that `TabSummary.tab_id` off the wire is ALREADY this composed shape:
 * Rust composes it in `projects_cache.rs`. Passing one back through here
 * yields `p1:p1:claude`, which matches no desktop recency key and no route.
 */
export function tabKey(projectId: string, tabId: string): string {
  return `${projectId}:${tabId}`
}

export interface RecencyEntry {
  key: string
  projectId: string
  tabId: string
  lastActiveAt?: number | undefined
}

/**
 * Flatten the tree into most-recently-used order, matching what the
 * desktop sidebar's recent view and command palette navigate by.
 *
 * Ordering spans projects on purpose: the desktop keys recency by
 * project and tab together, so moving through history crosses workspace
 * boundaries rather than being trapped inside the current one.
 * Never-activated tabs sort last, in tree order, so a fresh desktop
 * still yields a stable sequence.
 */
export function recencyOrder(projects: ProjectSummary[]): RecencyEntry[] {
  const entries: RecencyEntry[] = []
  for (const project of projects) {
    for (const tab of project.tabs) {
      entries.push({
        // Already composed on the wire; the raw half is what routes want.
        key: tab.tab_id,
        projectId: project.project_id,
        tabId: rawTabId(project.project_id, tab.tab_id),
        lastActiveAt: tab.last_active_at,
      })
    }
  }
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const at = a.entry.lastActiveAt
      const bt = b.entry.lastActiveAt
      if (at === undefined && bt === undefined) return a.index - b.index
      if (at === undefined) return 1
      if (bt === undefined) return -1
      if (at === bt) return a.index - b.index
      return bt - at
    })
    .map(({ entry }) => entry)
}

/**
 * A run of swipes walks this frozen copy rather than the live order.
 *
 * Stepping through a live MRU list oscillates: moving to the second
 * entry bumps it to the front, so the next step returns where you
 * started. Freezing for the duration of the run is the same thing
 * holding cmd while tabbing does.
 */
export interface SwipeRun {
  frozen: string[]
  index: number
}

export function beginSwipe(order: string[], currentKey: string): SwipeRun {
  const index = order.indexOf(currentKey)
  return { frozen: [...order], index: index < 0 ? 0 : index }
}

/**
 * Move one step through the frozen order. `dir` 1 goes further back in
 * history, -1 returns toward the most recent. Entries that have since
 * left the tree are stepped over rather than landed on, so a session
 * closed mid-run does not strand the walk. Both ends clamp.
 */
export function stepSwipe(
  run: SwipeRun,
  dir: 1 | -1,
  alive?: ReadonlySet<string>,
): SwipeRun {
  let next = run.index
  while (true) {
    const candidate = next + dir
    if (candidate < 0 || candidate >= run.frozen.length) return run
    next = candidate
    const key = run.frozen[next]
    if (!alive || (key !== undefined && alive.has(key))) {
      return { frozen: run.frozen, index: next }
    }
  }
}

/** The session the run landed on, which is the only one worth bumping. */
export function commitSwipe(run: SwipeRun): string | null {
  return run.frozen[run.index] ?? null
}
