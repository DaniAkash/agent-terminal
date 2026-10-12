import { describe, expect, test } from 'bun:test'
import {
  advanceSwipe,
  RUN_IDLE_MS,
  type SwipeState,
  swipeIntent,
} from './tab-swipe.helpers'

const ORDER = ['a', 'b', 'c', 'd']
const T0 = 10_000

/** Walk a run, feeding each result back in as the next step's previous. */
function walk(
  steps: readonly (1 | -1)[],
  order: readonly string[] = ORDER,
  gapMs = 100,
): string[] {
  let state: SwipeState | null = null
  let current = order[0] as string
  let now = T0
  const landed: string[] = []
  for (const dir of steps) {
    now += gapMs
    const out = advanceSwipe(state, dir, order, current, now)
    if (!out) continue
    state = out.state
    current = out.target
    landed.push(out.target)
  }
  return landed
}

describe('a run of swipes', () => {
  test('walks distinct sessions instead of oscillating between two', () => {
    // The bug this guards: stepping a LIVE most-recently-used list moves
    // the landed session to the front, so the next step returns to where
    // the run started and you can never reach the third session.
    expect(walk([1, 1, 1])).toEqual(['b', 'c', 'd'])
  })

  test('reverses back through the same sessions', () => {
    expect(walk([1, 1, -1])).toEqual(['b', 'c', 'b'])
  })

  test('clamps at the far end rather than wrapping', () => {
    expect(walk([1, 1, 1, 1, 1])).toEqual(['b', 'c', 'd'])
  })

  test('clamps at the near end too', () => {
    expect(walk([-1])).toEqual([])
  })
})

describe('when a run expires', () => {
  test('a pause starts a fresh run from the live order', () => {
    let now = T0
    const first = advanceSwipe(null, 1, ORDER, 'a', now)
    expect(first?.target).toBe('b')

    // The desktop reorders while the user is reading; `b` is now first.
    const reordered = ['b', 'a', 'c', 'd']
    now += RUN_IDLE_MS + 1
    const second = advanceSwipe(first?.state ?? null, 1, reordered, 'b', now)
    expect(second?.target).toBe('a')
  })

  test('within the window the frozen order is used, not the live one', () => {
    let now = T0
    const first = advanceSwipe(null, 1, ORDER, 'a', now)
    now += 100
    // Live order has changed, but the run is still inside its window.
    const second = advanceSwipe(first?.state ?? null, 1, ['b', 'a'], 'b', now)
    expect(second?.target).toBe('c')
  })

  test('a run overtaken by an outside jump starts over', () => {
    // The user taps a session in the switcher mid-run; `currentKey` no
    // longer matches where the frozen walk thinks it is.
    const first = advanceSwipe(null, 1, ORDER, 'a', T0)
    const second = advanceSwipe(first?.state ?? null, 1, ORDER, 'd', T0 + 100)
    expect(second).toBeNull()
  })
})

describe('sessions that disappear mid-run', () => {
  test('a closed session is stepped over, not landed on', () => {
    const alive = new Set(['a', 'c', 'd'])
    const out = advanceSwipe(null, 1, ORDER, 'a', T0, alive)
    expect(out?.target).toBe('c')
  })
})

describe('degenerate orders', () => {
  test('a single session has nowhere to go', () => {
    expect(advanceSwipe(null, 1, ['a'], 'a', T0)).toBeNull()
    expect(advanceSwipe(null, -1, ['a'], 'a', T0)).toBeNull()
  })

  test('an empty order does not throw', () => {
    expect(advanceSwipe(null, 1, [], 'a', T0)).toBeNull()
  })

  test('never reports landing on the session already open', () => {
    const out = advanceSwipe(null, 1, ['a', 'a'], 'a', T0)
    expect(out).toBeNull()
  })
})

describe('swipeIntent', () => {
  test('reads a clear vertical flick as opening the session list', () => {
    expect(swipeIntent(0, -80)).toBe('up')
  })

  test('reads horizontal flicks as stepping through history', () => {
    expect(swipeIntent(-80, 0)).toBe('back')
    expect(swipeIntent(80, 0)).toBe('forward')
  })

  test('resolves a diagonal to the axis the finger mostly went', () => {
    // Otherwise a sloppy flick either fires two gestures or none.
    expect(swipeIntent(-80, -30)).toBe('back')
    expect(swipeIntent(-30, -80)).toBe('up')
  })

  test('ignores a downward drag, which has no gesture bound to it', () => {
    expect(swipeIntent(0, 80)).toBeNull()
  })

  test('ignores travel below the threshold, so taps still reach the keys', () => {
    expect(swipeIntent(0, 0)).toBeNull()
    expect(swipeIntent(-10, 0)).toBeNull()
    expect(swipeIntent(0, -10)).toBeNull()
  })
})
