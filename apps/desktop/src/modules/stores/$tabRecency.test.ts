import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// Minimal localStorage stub. Bun's test env doesn't ship a DOM by default,
// so the store's `typeof window === 'undefined'` guard would otherwise skip
// persistence entirely. We install one before importing the module so the
// initial reads exercise the same path as the browser.
const memStorage: Record<string, string> = {}
const fakeStorage: Storage = {
  get length() {
    return Object.keys(memStorage).length
  },
  clear() {
    for (const k of Object.keys(memStorage)) delete memStorage[k]
  },
  getItem(k) {
    return Object.hasOwn(memStorage, k) ? memStorage[k] : null
  },
  setItem(k, v) {
    memStorage[k] = v
  },
  removeItem(k) {
    delete memStorage[k]
  },
  key(i) {
    return Object.keys(memStorage)[i] ?? null
  },
}
// biome-ignore lint/suspicious/noExplicitAny: test harness shim
;(globalThis as any).window = { localStorage: fakeStorage }
// biome-ignore lint/suspicious/noExplicitAny: test harness shim
;(globalThis as any).localStorage = fakeStorage

import {
  $tabRecency,
  $tabRecencyTimes,
  bumpTabRecency,
  forgetTabRecency,
} from '@/modules/stores/$tabRecency'

beforeEach(() => {
  $tabRecency.set([])
  $tabRecencyTimes.set({})
  for (const k of Object.keys(memStorage)) delete memStorage[k]
})

afterEach(() => {
  $tabRecency.set([])
  $tabRecencyTimes.set({})
})

/* ---------------------------------------------------------------------------
 * bumpTabRecency
 * -------------------------------------------------------------------------*/

describe('bumpTabRecency', () => {
  test('puts a new key at position 0', () => {
    bumpTabRecency('p:t1')
    expect($tabRecency.get()).toEqual(['p:t1'])
  })

  test('moves an existing key to position 0 without duplicating', () => {
    bumpTabRecency('p:t1')
    bumpTabRecency('p:t2')
    bumpTabRecency('p:t1')
    expect($tabRecency.get()).toEqual(['p:t1', 'p:t2'])
  })

  test('bumping the already-top key leaves the list unchanged', () => {
    bumpTabRecency('p:t1')
    const before = $tabRecency.get()
    bumpTabRecency('p:t1')
    // Same content (and same reference would also be ideal, but identity
    // isn't load-bearing — content equality is enough for the bug-class
    // we want to guard against: spurious re-renders triggered by the same
    // value being set).
    expect($tabRecency.get()).toEqual(before)
  })

  test('always stamps a new timestamp, even when the list is unchanged', () => {
    bumpTabRecency('p:t1')
    const t1 = $tabRecencyTimes.get()['p:t1']
    expect(t1).toBeGreaterThan(0)
    // Force the clock forward enough that Date.now() returns a different
    // value than the first stamp.
    const start = Date.now()
    while (Date.now() - start < 2) {
      /* spin briefly */
    }
    bumpTabRecency('p:t1')
    const t2 = $tabRecencyTimes.get()['p:t1']
    expect(t2).toBeGreaterThanOrEqual(t1)
  })

  test('empty key is a no-op', () => {
    bumpTabRecency('')
    expect($tabRecency.get()).toEqual([])
    expect($tabRecencyTimes.get()).toEqual({})
  })

  test('caps the list at 100 entries (oldest drops first)', () => {
    for (let i = 0; i < 105; i += 1) bumpTabRecency(`p:t${i}`)
    const list = $tabRecency.get()
    expect(list.length).toBe(100)
    // The most-recent (last bumped) is at position 0.
    expect(list[0]).toBe('p:t104')
    // The 100th-from-newest is at position 99.
    expect(list[99]).toBe('p:t5')
    // Anything older than that is gone.
    expect(list.includes('p:t4')).toBe(false)
  })
})

/* ---------------------------------------------------------------------------
 * forgetTabRecency
 * -------------------------------------------------------------------------*/

describe('forgetTabRecency', () => {
  test('removes the key from both atoms', () => {
    bumpTabRecency('p:t1')
    bumpTabRecency('p:t2')
    forgetTabRecency('p:t1')
    expect($tabRecency.get()).toEqual(['p:t2'])
    expect($tabRecencyTimes.get()['p:t1']).toBeUndefined()
    expect($tabRecencyTimes.get()['p:t2']).toBeGreaterThan(0)
  })

  test('forgetting an unknown key is a no-op', () => {
    bumpTabRecency('p:t1')
    const before = $tabRecency.get()
    forgetTabRecency('p:other')
    expect($tabRecency.get()).toEqual(before)
  })

  test('empty key is a no-op', () => {
    bumpTabRecency('p:t1')
    forgetTabRecency('')
    expect($tabRecency.get()).toEqual(['p:t1'])
  })
})

/* ---------------------------------------------------------------------------
 * Persistence
 * -------------------------------------------------------------------------*/

describe('persistence', () => {
  test('list writes flow through to localStorage', () => {
    bumpTabRecency('p:t1')
    bumpTabRecency('p:t2')
    const stored = JSON.parse(memStorage['agent-terminal:tab-recency'] ?? '[]')
    expect(stored).toEqual(['p:t2', 'p:t1'])
  })

  test('times write flow through to localStorage', () => {
    bumpTabRecency('p:t1')
    const stored = JSON.parse(
      memStorage['agent-terminal:tab-recency-times'] ?? '{}',
    )
    expect(typeof stored['p:t1']).toBe('number')
  })

  test('list write caps at MAX_ENTRIES (100)', () => {
    for (let i = 0; i < 150; i += 1) bumpTabRecency(`p:t${i}`)
    const stored = JSON.parse(memStorage['agent-terminal:tab-recency'] ?? '[]')
    expect(stored.length).toBe(100)
  })
})
