import { describe, expect, test } from 'bun:test'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import {
  beginSwipe,
  commitSwipe,
  recencyOrder,
  stepSwipe,
  tabKey,
} from './$recency.helpers'

function tab(tab_id: string, last_active_at?: number) {
  return { tab_id, label: tab_id, last_active_at }
}

function tree(): ProjectSummary[] {
  return [
    {
      project_id: 'p1',
      name: 'browseros',
      is_expanded: true,
      tabs: [tab('claude', 500), tab('tests', 300)],
    },
    {
      project_id: 'p2',
      name: 'aalai',
      is_expanded: true,
      tabs: [tab('codex', 900), tab('shell')],
    },
  ] as unknown as ProjectSummary[]
}

describe('tabKey', () => {
  test('matches the desktop composed key, so the two cannot drift', () => {
    expect(tabKey('p1', 't1')).toBe('p1:t1')
  })
})

describe('recencyOrder', () => {
  test('sorts most recent first and crosses project boundaries', () => {
    expect(recencyOrder(tree()).map((e) => e.key)).toEqual([
      'p2:codex',
      'p1:claude',
      'p1:tests',
      'p2:shell',
    ])
  })

  test('puts never-activated tabs last, in tree order', () => {
    const order = recencyOrder(tree())
    expect(order[order.length - 1]?.key).toBe('p2:shell')
  })

  test('is stable for equal timestamps rather than reordering randomly', () => {
    const t = [
      {
        project_id: 'p1',
        name: 'a',
        is_expanded: true,
        tabs: [tab('x', 100), tab('y', 100)],
      },
    ] as unknown as ProjectSummary[]
    expect(recencyOrder(t).map((e) => e.key)).toEqual(['p1:x', 'p1:y'])
  })

  test('yields nothing for an empty tree', () => {
    expect(recencyOrder([])).toEqual([])
  })
})

describe('swipe runs', () => {
  const order = ['a', 'b', 'c', 'd']

  test('a run of three steps back walks three distinct sessions', () => {
    let run = beginSwipe(order, 'a')
    const seen: (string | null)[] = []
    for (let i = 0; i < 3; i += 1) {
      run = stepSwipe(run, 1)
      seen.push(commitSwipe(run))
    }
    expect(seen).toEqual(['b', 'c', 'd'])
  })

  test('stepping back then forward returns to where the run started', () => {
    const start = beginSwipe(order, 'b')
    const there = stepSwipe(start, 1)
    const back = stepSwipe(there, -1)
    expect(commitSwipe(back)).toBe('b')
  })

  test('the frozen order does not move when the live order changes', () => {
    const run = beginSwipe(order, 'a')
    const moved = stepSwipe(run, 1)
    // A Projects frame arrives and reorders everything; the run is unaffected.
    expect(moved.frozen).toEqual(order)
    expect(commitSwipe(moved)).toBe('b')
  })

  test('only the landed session is returned, not every one traversed', () => {
    let run = beginSwipe(order, 'a')
    run = stepSwipe(run, 1)
    run = stepSwipe(run, 1)
    expect(commitSwipe(run)).toBe('c')
  })

  test('a session closed mid-run is stepped over, not landed on', () => {
    const alive = new Set(['a', 'c', 'd'])
    const run = stepSwipe(beginSwipe(order, 'a'), 1, alive)
    expect(commitSwipe(run)).toBe('c')
  })

  test('both ends clamp rather than wrapping', () => {
    expect(commitSwipe(stepSwipe(beginSwipe(order, 'a'), -1))).toBe('a')
    expect(commitSwipe(stepSwipe(beginSwipe(order, 'd'), 1))).toBe('d')
  })

  test('a current key missing from the order starts at the front', () => {
    expect(commitSwipe(beginSwipe(order, 'gone'))).toBe('a')
  })

  test('an empty order commits nothing instead of throwing', () => {
    expect(commitSwipe(beginSwipe([], 'a'))).toBeNull()
  })

  test('stepping past only-dead entries stays put', () => {
    const alive = new Set(['a'])
    const run = stepSwipe(beginSwipe(order, 'a'), 1, alive)
    expect(commitSwipe(run)).toBe('a')
  })
})
