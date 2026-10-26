import { describe, expect, test } from 'bun:test'
import { deriveTabVisual } from '../agent/agent.helpers'
import {
  cwdBasename,
  makeTabKey,
  rawTabId,
  resolveTabLabel,
} from './session.label'
import {
  ageBuckets,
  groupByWorkspace,
  orderByRecency,
  toRecentRows,
} from './session.order'
import type { SessionNode } from './session.types'

const NOW = 1_700_000_000_000

function node(over: Partial<SessionNode> & { key: string }): SessionNode {
  return {
    projectId: 'p1',
    projectName: 'browseros',
    projectPinned: false,
    projectExpanded: true,
    tabId: over.key.split(':')[1] ?? 't1',
    label: 'dev',
    pinned: false,
    isCurrent: false,
    visual: deriveTabVisual({ state: 'idle' }, NOW),
    ...over,
  }
}

describe('makeTabKey and rawTabId', () => {
  test('compose and decompose round-trip', () => {
    const key = makeTabKey('p1', 'claude')
    expect(key).toBe('p1:claude')
    expect(rawTabId('p1', key)).toBe('claude')
  })

  test('stripping an already-raw id leaves it alone', () => {
    // The wire hands back composed ids; anything that strips twice would
    // otherwise produce a key matching no tab.
    expect(rawTabId('p1', 'claude')).toBe('claude')
  })
})

describe('cwdBasename and resolveTabLabel', () => {
  test('takes the last segment with a leading slash', () => {
    expect(cwdBasename('/Users/you/code/agent-terminal')).toBe(
      '/agent-terminal',
    )
    expect(cwdBasename('/Users/you/code/agent-terminal/')).toBe(
      '/agent-terminal',
    )
    expect(cwdBasename('/')).toBe('/')
  })

  test('a name the user typed always wins', () => {
    expect(
      resolveTabLabel({ label: 'build', userRenamed: true }, '/tmp/other'),
    ).toBe('build')
  })

  test('otherwise the directory stands in for the name', () => {
    expect(resolveTabLabel({ label: 'shell' }, '/tmp/api')).toBe('/api')
  })

  test('falls back to the stored label before the first cwd arrives', () => {
    expect(resolveTabLabel({ label: 'shell' }, undefined)).toBe('shell')
  })
})

describe('orderByRecency', () => {
  test('most recent first', () => {
    const rows = orderByRecency([
      node({ key: 'p1:a', lastActiveAt: 100 }),
      node({ key: 'p1:b', lastActiveAt: 300 }),
      node({ key: 'p1:c', lastActiveAt: 200 }),
    ])
    expect(rows.map((r) => r.key)).toEqual(['p1:b', 'p1:c', 'p1:a'])
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3])
  })

  test('never-opened sessions sort last, in tree order', () => {
    const rows = orderByRecency([
      node({ key: 'p1:never-1' }),
      node({ key: 'p1:seen', lastActiveAt: 100 }),
      node({ key: 'p1:never-2' }),
    ])
    expect(rows.map((r) => r.key)).toEqual([
      'p1:seen',
      'p1:never-1',
      'p1:never-2',
    ])
  })

  test('rank counts only what was actually visited', () => {
    const rows = orderByRecency([
      node({ key: 'p1:seen', lastActiveAt: 100 }),
      node({ key: 'p1:never' }),
    ])
    expect(rows.map((r) => r.rank)).toEqual([1, 0])
  })

  test('ties break on tree order, so the sequence is stable', () => {
    const rows = orderByRecency([
      node({ key: 'p1:first', lastActiveAt: 500 }),
      node({ key: 'p1:second', lastActiveAt: 500 }),
    ])
    expect(rows.map((r) => r.key)).toEqual(['p1:first', 'p1:second'])
  })

  test('ordering crosses workspaces rather than grouping by them', () => {
    const rows = orderByRecency([
      node({ key: 'p1:a', projectId: 'p1', lastActiveAt: 100 }),
      node({ key: 'p2:b', projectId: 'p2', lastActiveAt: 300 }),
      node({ key: 'p1:c', projectId: 'p1', lastActiveAt: 200 }),
    ])
    expect(rows.map((r) => r.key)).toEqual(['p2:b', 'p1:c', 'p1:a'])
  })
})

describe('toRecentRows', () => {
  test('drops what was never opened', () => {
    const rows = orderByRecency([
      node({ key: 'p1:seen', lastActiveAt: 100 }),
      node({ key: 'p1:never' }),
    ])
    expect(toRecentRows(rows).map((r) => r.key)).toEqual(['p1:seen'])
  })
})

describe('groupByWorkspace', () => {
  test('pinned workspaces lead, and numbering follows display order', () => {
    const groups = groupByWorkspace([
      node({ key: 'p1:a', projectId: 'p1', projectName: 'one' }),
      node({
        key: 'p2:b',
        projectId: 'p2',
        projectName: 'two',
        projectPinned: true,
      }),
    ])
    expect(groups.map((g) => g.projectName)).toEqual(['two', 'one'])
    expect(groups.map((g) => g.position)).toEqual([1, 2])
  })

  test('pinned sessions lead inside a workspace', () => {
    const groups = groupByWorkspace([
      node({ key: 'p1:a' }),
      node({ key: 'p1:b', pinned: true }),
      node({ key: 'p1:c' }),
    ])
    expect(groups[0]?.sessions.map((s) => s.key)).toEqual([
      'p1:b',
      'p1:a',
      'p1:c',
    ])
  })

  test('carries the expand state so both devices fold the same tree', () => {
    const groups = groupByWorkspace([
      node({ key: 'p1:a', projectExpanded: false }),
    ])
    expect(groups[0]?.expanded).toBe(false)
  })

  test('workspace order follows the order the user arranged', () => {
    const groups = groupByWorkspace([
      node({ key: 'p3:a', projectId: 'p3', projectName: 'three' }),
      node({ key: 'p1:b', projectId: 'p1', projectName: 'one' }),
    ])
    expect(groups.map((g) => g.projectName)).toEqual(['three', 'one'])
  })
})

describe('ageBuckets', () => {
  test('is null for a session never opened', () => {
    expect(ageBuckets(NOW, undefined)).toBeNull()
  })

  test('splits an age into the units both formatters pick from', () => {
    expect(ageBuckets(NOW, NOW - 90_000)).toMatchObject({
      seconds: 90,
      minutes: 1,
      hours: 0,
      days: 0,
    })
    expect(ageBuckets(NOW, NOW - 3 * 86_400_000)).toMatchObject({ days: 3 })
  })

  test('a future stamp floors at zero rather than going negative', () => {
    // Two machines, two clocks. A phone a second ahead of the desktop
    // should read "now", not "-1s ago".
    expect(ageBuckets(NOW, NOW + 5_000)?.seconds).toBe(0)
  })
})
