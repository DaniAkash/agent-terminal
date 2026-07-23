import { describe, expect, test } from 'bun:test'
import type { SwitcherRow } from '@/components/TabSwitcher/tab-switcher.helpers'
import { toRecentSidebarRows } from './sidebar.helpers'

function row(over: Partial<SwitcherRow>): SwitcherRow {
  return {
    tabKey: 'p1:t1',
    projectId: 'p1',
    projectName: 'my-app',
    tabId: 't1',
    label: 'dev',
    cwd: undefined,
    rank: 1,
    lastActiveAt: 1000,
    isCurrent: false,
    ...over,
  }
}

describe('toRecentSidebarRows', () => {
  test('keeps only rows with rank > 0 (visited tabs)', () => {
    const input = [
      row({ tabKey: 'p1:t1', rank: 1 }),
      row({ tabKey: 'p1:t2', rank: 2 }),
      row({ tabKey: 'p2:t3', rank: 0 }), // never visited
    ]
    const out = toRecentSidebarRows(input)
    expect(out.map((r) => r.tabKey)).toEqual(['p1:t1', 'p1:t2'])
  })

  test('preserves the input order (which is recency order)', () => {
    const input = [
      row({ tabKey: 'p1:zeta', label: 'zeta', rank: 1 }),
      row({ tabKey: 'p1:alpha', label: 'alpha', rank: 2 }),
      row({ tabKey: 'p1:middle', label: 'middle', rank: 3 }),
    ]
    const out = toRecentSidebarRows(input)
    expect(out.map((r) => r.label)).toEqual(['zeta', 'alpha', 'middle'])
  })

  test('exposes projectName separately so the tooltip can render it', () => {
    const input = [row({ projectName: 'my-app' })]
    const out = toRecentSidebarRows(input)
    expect(out[0]?.projectName).toBe('my-app')
  })

  test('drops rank, lastActiveAt, cwd from the row shape', () => {
    const input = [row({ rank: 5, lastActiveAt: 12345, cwd: '/tmp/foo' })]
    const out = toRecentSidebarRows(input)
    // Row shape check: only these keys, no rank / lastActiveAt / cwd
    expect(Object.keys(out[0] ?? {}).sort()).toEqual([
      'isCurrent',
      'label',
      'projectId',
      'projectName',
      'tabId',
      'tabKey',
    ])
  })

  test('propagates isCurrent through', () => {
    const input = [
      row({ tabKey: 'p1:t1', isCurrent: true }),
      row({ tabKey: 'p1:t2', isCurrent: false }),
    ]
    const out = toRecentSidebarRows(input)
    expect(out[0]?.isCurrent).toBe(true)
    expect(out[1]?.isCurrent).toBe(false)
  })

  test('empty input yields empty output', () => {
    expect(toRecentSidebarRows([])).toEqual([])
  })
})
