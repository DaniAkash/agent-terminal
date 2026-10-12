import {
  beginSwipe,
  commitSwipe,
  type SwipeRun,
  stepSwipe,
} from '@/modules/stores/$recency.helpers'

/**
 * Consecutive swipes within this window continue one run through the
 * frozen order. A longer pause ends the run, so the next swipe re-reads
 * the live order and starts again from wherever you actually are.
 *
 * This is the stand-in for holding cmd while tabbing: a phone has no
 * modifier to hold, so the run is bounded by time instead.
 */
export const RUN_IDLE_MS = 1_500

export interface SwipeState {
  run: SwipeRun
  /** When the last step landed, used to decide whether a run is still live. */
  at: number
}

export type SwipeDirection = 1 | -1

/**
 * Advance one step through session history.
 *
 * Returns the next state plus the session to land on, or `null` when the
 * step would run off either end. Clamping rather than wrapping is
 * deliberate: wrapping makes it impossible to tell, mid-run, whether you
 * are about to revisit where you started.
 */
export function advanceSwipe(
  previous: SwipeState | null,
  direction: SwipeDirection,
  order: readonly string[],
  currentKey: string,
  now: number,
  alive?: ReadonlySet<string>,
): { state: SwipeState; target: string } | null {
  const live =
    previous !== null &&
    now - previous.at <= RUN_IDLE_MS &&
    // A run whose frozen order no longer contains where we are has been
    // overtaken by events; start over rather than walk a stale list.
    previous.run.frozen[previous.run.index] === currentKey
  const run = live ? previous.run : beginSwipe([...order], currentKey)
  const next = stepSwipe(run, direction, alive)
  if (next.index === run.index) return null
  const target = commitSwipe(next)
  if (target === null || target === currentKey) return null
  return { state: { run: next, at: now }, target }
}
