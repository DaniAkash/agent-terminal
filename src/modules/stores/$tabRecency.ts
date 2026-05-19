import { atom } from 'nanostores'

/* ---------------------------------------------------------------------------
 * $tabRecency — MRU list of tab keys.
 *
 * Index 0 is most recently active. Persisted to localStorage so the recency
 * signal survives app restarts (matches user expectation that "last week's
 * tabs" still rank lower than "5 minutes ago" after a quit-and-relaunch).
 *
 * Two parallel atoms instead of one Map<key, ts>:
 *   - $tabRecency holds the rank order (a string[] — index → rank)
 *   - $tabRecencyTimes holds last-activated epoch-ms (for the palette's
 *     "Nm ago" hints)
 *
 * The split keeps sidebar badge re-renders cheap: SidebarTabItem subscribes
 * to the order array only, so the every-30-seconds palette tick doesn't
 * invalidate the sidebar.
 * -------------------------------------------------------------------------*/

const STORAGE_KEY = 'agent-terminal:tab-recency'
const TIMES_KEY = 'agent-terminal:tab-recency-times'
const MAX_ENTRIES = 100

function readPersistedList(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    return []
  }
}

function readPersistedTimes(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(TIMES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export const $tabRecency = atom<string[]>(readPersistedList())
export const $tabRecencyTimes = atom<Record<string, number>>(
  readPersistedTimes(),
)

$tabRecency.subscribe((value) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(value.slice(0, MAX_ENTRIES)),
    )
  } catch {
    /* localStorage full / disabled — recency degrades to in-memory */
  }
})

$tabRecencyTimes.subscribe((value) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TIMES_KEY, JSON.stringify(value))
  } catch {
    /* same — non-fatal */
  }
})

/**
 * Move `tabKey` to the front of the MRU list and stamp its time. No-op for
 * an empty key. When the key is already at position 0 the list is left
 * untouched (no spurious atom write) and only the timestamp is bumped.
 */
export function bumpTabRecency(tabKey: string): void {
  if (!tabKey) return
  const cur = $tabRecency.get()
  if (cur[0] !== tabKey) {
    const filtered = cur.filter((k) => k !== tabKey)
    filtered.unshift(tabKey)
    $tabRecency.set(filtered.slice(0, MAX_ENTRIES))
  }
  $tabRecencyTimes.set({ ...$tabRecencyTimes.get(), [tabKey]: Date.now() })
}

/**
 * Remove a closed tab from both atoms so the sidebar and palette never
 * reference a dead tabKey.
 */
export function forgetTabRecency(tabKey: string): void {
  if (!tabKey) return
  const cur = $tabRecency.get()
  const next = cur.filter((k) => k !== tabKey)
  if (next.length !== cur.length) $tabRecency.set(next)
  const times = $tabRecencyTimes.get()
  if (times[tabKey] !== undefined) {
    const { [tabKey]: _, ...rest } = times
    $tabRecencyTimes.set(rest)
  }
}
