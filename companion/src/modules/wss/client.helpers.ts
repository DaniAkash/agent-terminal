// First two attempts fire fast so a foreground / network-transition
// resume feels instant. From attempt 2 onward we fall into exponential
// backoff so a genuinely-down desktop doesn't get hammered.
const FAST_ATTEMPT_DELAYS_MS = [250, 500] as const
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000
const JITTER_MAX_MS = 250

export interface BackoffDeps {
  /** Injected for tests. Defaults to `Math.random`. */
  random?: () => number
}

/**
 * Delay before reconnect attempt N (0-indexed). Layered:
 *
 * - Attempt 0: 250 ms
 * - Attempt 1: 500 ms
 * - Attempt 2+: 1000 * 2^(attempt - 2), capped at 30 s, plus 0-249 ms
 *   of jitter to avoid thundering-herd when multiple mobile clients wake
 *   from a shared "Wi-Fi came back" event.
 */
export function computeBackoffDelay(
  attempt: number,
  deps: BackoffDeps = {},
): number {
  const fast = FAST_ATTEMPT_DELAYS_MS[attempt]
  if (fast !== undefined) return fast
  const random = deps.random ?? Math.random
  const exponent = attempt - 2
  const raw = BACKOFF_MIN_MS * 2 ** exponent
  const base = Math.min(raw, BACKOFF_MAX_MS)
  return base + Math.floor(random() * JITTER_MAX_MS)
}
