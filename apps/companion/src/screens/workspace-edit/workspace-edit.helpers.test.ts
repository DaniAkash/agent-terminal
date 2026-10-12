import { describe, expect, test } from 'bun:test'
import type { TabSummary } from '@/modules/wss/protocol.gen'
import { pinnedFirst, reorderMove } from './workspace-edit.helpers'

function tab(id: string, pinned = false): TabSummary {
  return { tab_id: id, label: id, pinned } as TabSummary
}

const BEFORE = [tab('a'), tab('b'), tab('c'), tab('d')]

describe('reorderMove', () => {
  test('reports the single move a drop produced', () => {
    const after = [tab('b'), tab('a'), tab('c'), tab('d')]
    expect(reorderMove(BEFORE, after)).toEqual({ old_index: 1, new_index: 0 })
  })

  test('describes a move to the end as one pair, not a cascade', () => {
    const after = [tab('b'), tab('c'), tab('d'), tab('a')]
    expect(reorderMove(BEFORE, after)).toEqual({ old_index: 1, new_index: 0 })
  })

  test('is null when nothing actually moved', () => {
    expect(reorderMove(BEFORE, [...BEFORE])).toBeNull()
  })

  test('bails when the drop refers to a tab the snapshot lost', () => {
    // A Projects push removed `b` while the finger was down. Sending the
    // -1 that findIndex returns would fail the desktop's unsigned decode
    // and take the socket with it.
    const after = [tab('x'), tab('a'), tab('c'), tab('d')]
    expect(reorderMove(BEFORE, after)).toBeNull()
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
