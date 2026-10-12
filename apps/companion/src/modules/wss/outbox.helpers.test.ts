import { describe, expect, test } from 'bun:test'
import {
  drainWrites,
  enqueueWrite,
  MAX_QUEUED_WRITES,
  type QueuedWrite,
  queuedFor,
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
    for (const c of ['a', 'b', 'c', 'd']) q = enqueueWrite(q, w('p1:t1', c), 3)
    expect(q.map((x) => x.data)).toEqual(['b', 'c', 'd'])
  })

  test('never grows past the cap however much is typed', () => {
    let q: QueuedWrite[] = []
    for (let i = 0; i < 1000; i += 1) q = enqueueWrite(q, w('p1:t1', 'x'), 10)
    expect(q.length).toBe(10)
  })

  test('has a bound even when none is passed', () => {
    let q: QueuedWrite[] = []
    for (let i = 0; i < MAX_QUEUED_WRITES + 50; i += 1) {
      q = enqueueWrite(q, w('p1:t1', 'x'))
    }
    expect(q.length).toBe(MAX_QUEUED_WRITES)
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

describe('queuedFor', () => {
  test('counts only the session asked about', () => {
    const queue = [w('p1:t1', 'a'), w('p1:t2', 'b'), w('p1:t1', 'c')]
    expect(queuedFor(queue, 'p1:t1')).toBe(2)
    expect(queuedFor(queue, 'p1:t2')).toBe(1)
    expect(queuedFor(queue, 'p1:gone')).toBe(0)
  })
})
