import type { TabSummary } from '@/modules/wss/protocol.gen'

export interface ReorderMove {
  old_index: number
  new_index: number
}

/**
 * Turn the order a drop produced into the single move the desktop expects.
 *
 * Returns null when nothing moved, and also when the dropped order refers
 * to a tab the current snapshot does not have: that means the drag raced a
 * Projects push, and a wrong index is worse than a dropped reorder. The
 * desktop decodes the index as an unsigned int, so sending -1 would take
 * the socket down with it.
 */
export function reorderMove(
  before: readonly TabSummary[],
  after: readonly TabSummary[],
): ReorderMove | null {
  for (let newIndex = 0; newIndex < after.length; newIndex += 1) {
    const moved = after[newIndex]
    if (!moved) continue
    const oldIndex = before.findIndex((t) => t.tab_id === moved.tab_id)
    if (oldIndex < 0) return null
    if (oldIndex !== newIndex)
      return { old_index: oldIndex, new_index: newIndex }
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
