import { describe, expect, test } from 'bun:test'
import type { TabSummary } from '@/modules/wss/protocol.gen'
import { pinnedFirst, reorderMove } from './workspace-edit.helpers'

function tab(id: string, pinned = false): TabSummary {
  return { tab_id: id, label: id, pinned } as TabSummary
}

const BEFORE = [tab('a'), tab('b'), tab('c'), tab('d')]

/**
 * Replay a derived move the way the desktop store does, so the assertion is
 * about where the list ends up rather than about the pair of numbers. The
 * pair being "a difference" is what let a wrong move ship before.
 */
function applied(after: TabSummary[]): string[] | null {
  const move = reorderMove(BEFORE, after)
  if (!move) return null
  const ids = BEFORE.map((t) => t.tab_id)
  const [item] = ids.splice(move.old_index, 1)
  if (item === undefined) return null
  ids.splice(move.new_index, 0, item)
  return ids
}

describe('reorderMove lands the desktop on the order the user dropped', () => {
  test('a session dragged one place toward the front', () => {
    expect(applied([tab('b'), tab('a'), tab('c'), tab('d')])).toEqual([
      'b',
      'a',
      'c',
      'd',
    ])
  })

  test('a session dragged all the way to the end', () => {
    // The regression: the first differing pair described moving `b` to the
    // front, so the desktop landed on b,a,c,d while the user dropped b,c,d,a.
    expect(applied([tab('b'), tab('c'), tab('d'), tab('a')])).toEqual([
      'b',
      'c',
      'd',
      'a',
    ])
  })

  test('a session dragged all the way to the front', () => {
    expect(applied([tab('d'), tab('a'), tab('b'), tab('c')])).toEqual([
      'd',
      'a',
      'b',
      'c',
    ])
  })

  test('a session dragged from the middle toward the end', () => {
    expect(applied([tab('a'), tab('c'), tab('d'), tab('b')])).toEqual([
      'a',
      'c',
      'd',
      'b',
    ])
  })

  test('a session dragged from the end into the middle', () => {
    expect(applied([tab('a'), tab('d'), tab('b'), tab('c')])).toEqual([
      'a',
      'd',
      'b',
      'c',
    ])
  })

  test('every single-item move in a four-item list round-trips', () => {
    const ids = BEFORE.map((t) => t.tab_id)
    for (let from = 0; from < ids.length; from += 1) {
      for (let to = 0; to < ids.length; to += 1) {
        const expected = [...ids]
        const [item] = expected.splice(from, 1)
        expected.splice(to, 0, item as string)
        const after = expected.map((id) => tab(id))
        if (from === to) continue
        expect(applied(after)).toEqual(expected)
      }
    }
  })
})

describe('reorderMove refuses rather than guessing', () => {
  test('is null when nothing actually moved', () => {
    expect(reorderMove(BEFORE, [...BEFORE])).toBeNull()
  })

  test('bails when the drop refers to a session the snapshot lost', () => {
    // A Projects push removed `b` while the finger was down. No single move
    // reproduces this, so nothing is sent: a wrong index would be decoded as
    // unsigned by the desktop and take the socket with it.
    expect(
      reorderMove(BEFORE, [tab('x'), tab('a'), tab('c'), tab('d')]),
    ).toBeNull()
  })

  test('bails on a shuffle that is not one move', () => {
    expect(
      reorderMove(BEFORE, [tab('b'), tab('a'), tab('d'), tab('c')]),
    ).toBeNull()
  })

  test('bails when the two lists are different lengths', () => {
    expect(reorderMove(BEFORE, [tab('a'), tab('b')])).toBeNull()
  })

  test('handles an empty list without throwing', () => {
    expect(reorderMove([], [])).toBeNull()
  })
})

describe('pinnedFirst', () => {
  test('lifts pinned tabs without shuffling either group', () => {
    const tabs = [tab('a'), tab('b', true), tab('c'), tab('d', true)]
    expect(pinnedFirst(tabs).map((t) => t.tab_id)).toEqual(['b', 'd', 'a', 'c'])
  })

  test('leaves a list with no pins exactly as it was', () => {
    expect(pinnedFirst(BEFORE).map((t) => t.tab_id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  test('does not mutate its input', () => {
    const tabs = [tab('a'), tab('b', true)]
    pinnedFirst(tabs)
    expect(tabs.map((t) => t.tab_id)).toEqual(['a', 'b'])
  })
})
