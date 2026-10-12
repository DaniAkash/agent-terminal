import { describe, expect, test } from 'bun:test'
import {
  drainWrites,
  enqueueWrite,
  MAX_QUEUED_CHARS,
  MAX_QUEUED_WRITES,
  type QueuedWrite,
  tallyByTab,
} from './outbox.helpers'

const w = (tabId: string, data: string): QueuedWrite => ({ tabId, data })

describe('enqueueWrite', () => {
  test('keeps keystrokes in the order they were typed', () => {
    let q: QueuedWrite[] = []
    for (const c of ['l', 's', '\r']) q = enqueueWrite(q, w('p1:t1', c))
    expect(q.map((x) => x.data)).toEqual(['l', 's', '\r'])
  })

  test('drops the oldest once the cap is reached', () => {
    // The newest keystrokes are the ones still connected to what the user
    // currently intends, so the buffer forgets from the front.
    let q: QueuedWrite[] = []
    for (const c of ['a', 'b', 'c', 'd']) {
      q = enqueueWrite(q, w('p1:t1', c), { maxWrites: 3 })
    }
    expect(q.map((x) => x.data)).toEqual(['b', 'c', 'd'])
  })

  test('never grows past the cap however much is typed', () => {
    let q: QueuedWrite[] = []
    for (let i = 0; i < 1000; i += 1) {
      q = enqueueWrite(q, w('p1:t1', 'x'), { maxWrites: 10 })
    }
    expect(q.length).toBe(10)
  })

  test('has a bound even when none is passed', () => {
    let q: QueuedWrite[] = []
    for (let i = 0; i < MAX_QUEUED_WRITES + 50; i += 1) {
      q = enqueueWrite(q, w('p1:t1', 'x'))
    }
    expect(q.length).toBe(MAX_QUEUED_WRITES)
  })

  test('bounds total input, not just the number of entries', () => {
    // The write cap alone leaves the queue unbounded in size: pasted text
    // arrives as one entry of any length.
    let q: QueuedWrite[] = []
    for (let i = 0; i < 20; i += 1) {
      q = enqueueWrite(q, w('p1:t1', 'x'.repeat(100)), { maxChars: 250 })
    }
    expect(q.length).toBe(2)
    expect(q.reduce((n, x) => n + x.data.length, 0)).toBeLessThanOrEqual(250)
  })

  test('refuses a single write too big to fit rather than emptying the queue', () => {
    const q = enqueueWrite([w('p1:t1', 'typed')], w('p1:t1', 'x'.repeat(400)), {
      maxChars: 250,
    })
    expect(q.map((x) => x.data)).toEqual(['typed'])
  })

  test('has a size bound even when none is passed', () => {
    const q = enqueueWrite([], w('p1:t1', 'x'.repeat(MAX_QUEUED_CHARS + 1)))
    expect(q).toEqual([])
  })

  test('does not mutate the queue it was given', () => {
    const q = [w('p1:t1', 'a')]
    enqueueWrite(q, w('p1:t1', 'b'))
    expect(q.length).toBe(1)
  })
})

describe('drainWrites', () => {
  const queue = [w('p1:t1', 'r'), w('p1:t2', 'm'), w('p1:t1', '\r')]

  test('sends only what belongs to a session still being streamed', () => {
    const { flush } = drainWrites(queue, (id) => id === 'p1:t1')
    expect(flush).toEqual([w('p1:t1', 'r'), w('p1:t1', '\r')])
  })

  test('drops rather than redirects a keystroke whose session is gone', () => {
    // The rule that matters: a half-typed destructive command must never
    // arrive in a different shell than the one it was typed into.
    const { flush, dropped } = drainWrites(queue, (id) => id === 'p1:t1')
    expect(dropped).toEqual([w('p1:t2', 'm')])
    expect(flush.every((x) => x.tabId === 'p1:t1')).toBe(true)
  })

  test('drops everything when no session survived', () => {
    const { flush, dropped } = drainWrites(queue, () => false)
    expect(flush).toEqual([])
    expect(dropped.length).toBe(3)
  })

  test('preserves order within a session', () => {
    const { flush } = drainWrites(queue, () => true)
    expect(flush.map((x) => x.data)).toEqual(['r', 'm', '\r'])
  })

  test('an empty queue drains to nothing', () => {
    expect(drainWrites([], () => true)).toEqual({ flush: [], dropped: [] })
  })
})

describe('tallyByTab', () => {
  test('counts what was replayed per session', () => {
    const counts = tallyByTab([
      w('p1:t1', 'a'),
      w('p1:t2', 'b'),
      w('p1:t1', 'c'),
    ])
    expect(counts.get('p1:t1')).toBe(2)
    expect(counts.get('p1:t2')).toBe(1)
    expect(counts.get('p1:gone')).toBeUndefined()
  })

  test('nothing replayed is no counts at all', () => {
    expect(tallyByTab([]).size).toBe(0)
  })
})
