import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { Terminal } from '@xterm/xterm'
import { createWebglLifecycle } from '@/components/XTermTerminal/xterm-terminal.webgl'

/* ---------------------------------------------------------------------------
 * Minimal mocks for the two xterm objects the lifecycle touches.
 *
 * The lifecycle's contract is a small surface — onContextLoss capture,
 * dispose, loadAddon, refresh, rows — so the mocks only model that.
 * -------------------------------------------------------------------------*/

function makeAddon() {
  let onLoss: (() => void) | null = null
  return {
    onContextLoss: mock((cb: () => void) => {
      onLoss = cb
    }),
    dispose: mock(() => {}),
    fireContextLoss: () => onLoss?.(),
  }
}

type FakeAddon = ReturnType<typeof makeAddon>

function makeTerm(rows = 24) {
  return {
    rows,
    loadAddon: mock((_addon: unknown) => {}),
    refresh: mock((_start: number, _end: number) => {}),
  }
}

type FakeTerm = ReturnType<typeof makeTerm>

type Harness = {
  term: FakeTerm
  addons: FakeAddon[]
  scheduled: Array<() => void>
  flushScheduled: () => void
  setActive: (v: boolean) => void
  advanceTime: (ms: number) => void
  // The active-tab predicate captured at construction so individual
  // tests can flip it from true to false to exercise the
  // microtask-bailout path.
  isActive: () => boolean
}

function makeHarness(opts?: { startActive?: boolean }): {
  harness: Harness
  lifecycle: ReturnType<typeof createWebglLifecycle>
} {
  const term = makeTerm()
  const addons: FakeAddon[] = []
  const scheduled: Array<() => void> = []
  let active = opts?.startActive ?? true
  let virtualNow = 0

  const harness: Harness = {
    term,
    addons,
    scheduled,
    flushScheduled: () => {
      const queue = scheduled.splice(0, scheduled.length)
      for (const fn of queue) fn()
    },
    setActive: (v) => {
      active = v
    },
    advanceTime: (ms) => {
      virtualNow += ms
    },
    isActive: () => active,
  }

  const lifecycle = createWebglLifecycle({
    term: term as unknown as Terminal,
    createAddon: () => {
      const a = makeAddon()
      addons.push(a)
      return a as unknown as WebglAddon
    },
    isActive: () => active,
    scheduleRetry: (fn) => {
      scheduled.push(fn)
    },
    now: () => virtualNow,
  })

  return { harness, lifecycle }
}

let harness: Harness
let lifecycle: ReturnType<typeof createWebglLifecycle>

beforeEach(() => {
  ;({ harness, lifecycle } = makeHarness())
})

/* ---------------------------------------------------------------------------
 * enableWebgl() — construction + idempotency + refresh
 * -------------------------------------------------------------------------*/
describe('enableWebgl()', () => {
  test('1: constructs an addon, loads it, refreshes the visible buffer', () => {
    lifecycle.enableWebgl()
    expect(harness.addons.length).toBe(1)
    expect(harness.term.loadAddon).toHaveBeenCalledTimes(1)
    expect(harness.term.refresh).toHaveBeenCalledTimes(1)
    expect(harness.term.refresh).toHaveBeenCalledWith(0, 23)
  })

  test('2: idempotent — a second call while already enabled is a no-op', () => {
    lifecycle.enableWebgl()
    lifecycle.enableWebgl()
    expect(harness.addons.length).toBe(1)
    expect(harness.term.loadAddon).toHaveBeenCalledTimes(1)
    expect(harness.term.refresh).toHaveBeenCalledTimes(1)
  })

  test('3: isEnabled reflects state', () => {
    expect(lifecycle.isEnabled()).toBe(false)
    lifecycle.enableWebgl()
    expect(lifecycle.isEnabled()).toBe(true)
  })

  test('4: skips refresh when rows is zero (pre-fit), still loads addon', () => {
    const { harness: h, lifecycle: lc } = makeHarness()
    h.term.rows = 0
    lc.enableWebgl()
    expect(h.term.loadAddon).toHaveBeenCalledTimes(1)
    expect(h.term.refresh).not.toHaveBeenCalled()
  })

  test('5: createAddon throwing leaves us cleanly disabled', () => {
    const term = makeTerm()
    const lc = createWebglLifecycle({
      term: term as unknown as Terminal,
      createAddon: () => {
        throw new Error('WebGL2 not supported in this context')
      },
      isActive: () => true,
    })
    lc.enableWebgl()
    expect(lc.isEnabled()).toBe(false)
    expect(term.loadAddon).not.toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------------------------
 * disableWebgl() — dispose + refresh on every transition
 * -------------------------------------------------------------------------*/
describe('disableWebgl()', () => {
  test('6: disposes the addon and refreshes once', () => {
    lifecycle.enableWebgl()
    harness.term.refresh.mockClear()
    lifecycle.disableWebgl()
    expect(harness.addons[0].dispose).toHaveBeenCalledTimes(1)
    expect(harness.term.refresh).toHaveBeenCalledTimes(1)
    expect(lifecycle.isEnabled()).toBe(false)
  })

  test('7: no-op when not currently enabled', () => {
    lifecycle.disableWebgl()
    expect(harness.term.refresh).not.toHaveBeenCalled()
  })

  test('8: enable → disable → enable allocates a fresh addon', () => {
    lifecycle.enableWebgl()
    lifecycle.disableWebgl()
    lifecycle.enableWebgl()
    expect(harness.addons.length).toBe(2)
    expect(harness.addons[0].dispose).toHaveBeenCalledTimes(1)
    expect(harness.addons[1].dispose).not.toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------------------------
 * onContextLoss — dispose, refresh, bounded microtask retry
 * -------------------------------------------------------------------------*/
describe('context loss handling', () => {
  test('9: first loss disposes, refreshes, and schedules a retry', () => {
    lifecycle.enableWebgl()
    harness.term.refresh.mockClear()
    harness.addons[0].fireContextLoss()

    expect(harness.addons[0].dispose).toHaveBeenCalledTimes(1)
    expect(harness.term.refresh).toHaveBeenCalledTimes(1)
    expect(harness.scheduled.length).toBe(1)
    expect(lifecycle.isEnabled()).toBe(false)
  })

  test('10: scheduled retry re-enables when isActive is still true', () => {
    lifecycle.enableWebgl()
    harness.addons[0].fireContextLoss()
    harness.flushScheduled()
    expect(harness.addons.length).toBe(2)
    expect(lifecycle.isEnabled()).toBe(true)
  })

  test('11: scheduled retry bails out when isActive flips to false', () => {
    lifecycle.enableWebgl()
    harness.addons[0].fireContextLoss()
    harness.setActive(false)
    harness.flushScheduled()
    expect(harness.addons.length).toBe(1)
    expect(lifecycle.isEnabled()).toBe(false)
  })

  test('12: two losses inside the retry window — second skips the retry', () => {
    lifecycle.enableWebgl()
    harness.addons[0].fireContextLoss()
    harness.flushScheduled()
    // Now back to enabled. Loss again, immediately — no second retry.
    harness.addons[1].fireContextLoss()
    expect(harness.scheduled.length).toBe(0)
    expect(lifecycle.isEnabled()).toBe(false)
  })

  test('13: a loss outside the retry window — retry happens', () => {
    lifecycle.enableWebgl()
    harness.addons[0].fireContextLoss()
    harness.flushScheduled()
    // Advance past the retry window so the second loss is not "recent".
    harness.advanceTime(6000)
    harness.addons[1].fireContextLoss()
    expect(harness.scheduled.length).toBe(1)
    harness.flushScheduled()
    expect(harness.addons.length).toBe(3)
    expect(lifecycle.isEnabled()).toBe(true)
  })

  test('14: loss handler refreshes even when isEnabled was set via the old addon', () => {
    lifecycle.enableWebgl()
    harness.term.refresh.mockClear()
    harness.addons[0].fireContextLoss()
    expect(harness.term.refresh).toHaveBeenCalledWith(0, 23)
  })
})

/* ---------------------------------------------------------------------------
 * dispose() — unmount path, no refresh side effect
 * -------------------------------------------------------------------------*/
describe('dispose()', () => {
  test('15: disposes the live addon without firing refresh', () => {
    lifecycle.enableWebgl()
    harness.term.refresh.mockClear()
    lifecycle.dispose()
    expect(harness.addons[0].dispose).toHaveBeenCalledTimes(1)
    expect(harness.term.refresh).not.toHaveBeenCalled()
  })

  test('16: enable after dispose is a no-op (lifecycle is one-shot)', () => {
    lifecycle.dispose()
    lifecycle.enableWebgl()
    expect(harness.addons.length).toBe(0)
    expect(lifecycle.isEnabled()).toBe(false)
  })

  test('17: queued retry after dispose does nothing', () => {
    lifecycle.enableWebgl()
    harness.addons[0].fireContextLoss()
    // dispose happens between loss and retry firing.
    lifecycle.dispose()
    harness.flushScheduled()
    expect(harness.addons.length).toBe(1)
    expect(lifecycle.isEnabled()).toBe(false)
  })

  test('18: dispose with no live addon is a no-op', () => {
    lifecycle.dispose()
    expect(harness.term.refresh).not.toHaveBeenCalled()
  })
})
