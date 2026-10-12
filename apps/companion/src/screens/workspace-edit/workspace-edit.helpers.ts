import type { TabSummary } from '@/modules/wss/protocol.gen'

export interface ReorderMove {
  old_index: number
  new_index: number
}

/** The desktop's own reorder, so a candidate can be checked against it. */
function applyMove(ids: readonly string[], from: number, to: number): string[] {
  const out = [...ids]
  const [item] = out.splice(from, 1)
  if (item === undefined) return out
  out.splice(to, 0, item)
  return out
}

/**
 * Turn the order a drop produced into the single move the desktop expects.
 *
 * The candidate is verified by replaying it the way the desktop will before
 * it is returned. Deriving a pair from the first index that differs is not
 * enough: that describes *a* difference rather than *the* move, and for a
 * session dragged toward the end it names a different move entirely, so the
 * desktop lands on an order the user never asked for. Replaying is cheap
 * and makes a wrong pair impossible to emit.
 *
 * Returns null when nothing moved, and when no single move reproduces the
 * drop. That second case covers a drag that raced a Projects push: the
 * dropped order then refers to a session the snapshot no longer has, and a
 * wrong index is worse than a dropped reorder. The desktop decodes the
 * index as unsigned, so a negative one would take the socket down with it.
 */
export function reorderMove(
  before: readonly TabSummary[],
  after: readonly TabSummary[],
): ReorderMove | null {
  if (before.length !== after.length) return null
  const beforeIds = before.map((t) => t.tab_id)
  const afterIds = after.map((t) => t.tab_id)

  let first = 0
  while (first < beforeIds.length && beforeIds[first] === afterIds[first]) {
    first += 1
  }
  if (first === beforeIds.length) return null

  let last = beforeIds.length - 1
  while (last > first && beforeIds[last] === afterIds[last]) last -= 1

  // One item moved: it either came from `last` and landed at `first`, or
  // came from `first` and landed at `last`. Everything between shifts by one.
  const target = afterIds.join('\u0000')
  for (const candidate of [
    { old_index: last, new_index: first },
    { old_index: first, new_index: last },
  ]) {
    const replayed = applyMove(
      beforeIds,
      candidate.old_index,
      candidate.new_index,
    )
    if (replayed.join('\u0000') === target) return candidate
  }
  return null
}

/**
 * Pinned tabs first, each group keeping its own order.
 *
 * Mirrors what the desktop store does on a pin, so the list does not
 * visibly re-sort a moment later when the resulting tree comes back.
 */
export function pinnedFirst(tabs: readonly TabSummary[]): TabSummary[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)]
}
