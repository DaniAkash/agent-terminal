import { describe, expect, test } from 'bun:test'
import {
  buildSwitcherRows,
  type SwitcherRow,
} from '@/components/TabSwitcher/tab-switcher.helpers'
import type { Project } from '@/screens/workspace/workspace.types'

/* ---------------------------------------------------------------------------
 * Fixtures
 * -------------------------------------------------------------------------*/

function makeProjects(): Project[] {
  return [
    {
      id: 'agent',
      name: 'agent-terminal',
      path: '~/work/agent-terminal',
      pinned: false,
      tabs: [
        { id: 'dev', label: 'dev', cmd: '', pinned: false },
        { id: 'srv', label: 'server', cmd: '', pinned: false },
        { id: 'git', label: 'git status', cmd: '', pinned: false },
      ],
    },
    {
      id: 'cc',
      name: 'control-center',
      path: '~/cc',
      pinned: false,
      tabs: [
        { id: 'mem', label: 'memory', cmd: '', pinned: false },
        { id: 'docs', label: 'docs review', cmd: '', pinned: false },
      ],
    },
  ]
}

function build(
  recency: string[],
  opts: {
    recencyTimes?: Record<string, number>
    activeProjectId?: string
    activeTabIds?: Record<string, string>
    tabMeta?: Record<string, { cwd?: string }>
  } = {},
): SwitcherRow[] {
  return buildSwitcherRows({
    projects: makeProjects(),
    recency,
    recencyTimes: opts.recencyTimes ?? {},
    tabMeta: opts.tabMeta ?? {},
    activeProjectId: opts.activeProjectId ?? '',
    activeTabIds: opts.activeTabIds ?? {},
  })
}

/* ---------------------------------------------------------------------------
 * buildSwitcherRows
 * -------------------------------------------------------------------------*/

describe('buildSwitcherRows', () => {
  test('recency-listed tabs appear first in recency order with 1-based rank', () => {
    const rows = build(['cc:mem', 'agent:dev', 'agent:srv'])
    expect(rows.slice(0, 3).map((r) => r.tabKey)).toEqual([
      'cc:mem',
      'agent:dev',
      'agent:srv',
    ])
    expect(rows.slice(0, 3).map((r) => r.rank)).toEqual([1, 2, 3])
  })

  test('rank is uncapped — the 12th recent tab has rank 12', () => {
    // Recency list of 12 distinct keys; only the first 5 exist as tabs
    // in projects, but cap-checking the rank doesn't depend on tab
    // existence — verify by using a single recency list that aligns with
    // tabs in projects.
    const projects: Project[] = [
      {
        id: 'p',
        name: 'p',
        path: '~/p',
        pinned: false,
        tabs: Array.from({ length: 12 }, (_, i) => ({
          id: `t${i}`,
          label: `t${i}`,
          cmd: '',
          pinned: false,
        })),
      },
    ]
    const recency = Array.from({ length: 12 }, (_, i) => `p:t${i}`)
    const rows = buildSwitcherRows({
      projects,
      recency,
      recencyTimes: {},
      tabMeta: {},
      activeProjectId: '',
      activeTabIds: {},
    })
    expect(rows.length).toBe(12)
    expect(rows[11].rank).toBe(12)
    expect(rows[11].tabKey).toBe('p:t11')
  })

  test('never-visited tabs have rank 0 and appear after recency-listed ones', () => {
    const rows = build(['cc:mem'])
    // 1 recency-listed + 4 never-visited (dev, srv, git from agent, docs from cc)
    expect(rows.length).toBe(5)
    expect(rows[0]).toMatchObject({ tabKey: 'cc:mem', rank: 1 })
    // Rest are rank 0 and in sidebar order (project → tab declaration order)
    expect(rows.slice(1).map((r) => r.tabKey)).toEqual([
      'agent:dev',
      'agent:srv',
      'agent:git',
      'cc:docs',
    ])
    expect(rows.slice(1).every((r) => r.rank === 0)).toBe(true)
  })

  test('stale recency entries (no matching tab) are dropped silently', () => {
    const rows = build(['ghost:abc', 'agent:dev', 'also:stale'])
    expect(rows.find((r) => r.tabKey === 'ghost:abc')).toBeUndefined()
    expect(rows.find((r) => r.tabKey === 'also:stale')).toBeUndefined()
    // agent:dev still appears, but with rank 2 (its index in the
    // recency array) — we don't renumber to skip orphans.
    const dev = rows.find((r) => r.tabKey === 'agent:dev')
    expect(dev?.rank).toBe(2)
  })

  test('isCurrent is true only for the active project + tab pair', () => {
    const rows = build([], {
      activeProjectId: 'agent',
      activeTabIds: { agent: 'dev' },
    })
    expect(rows.find((r) => r.tabKey === 'agent:dev')?.isCurrent).toBe(true)
    expect(rows.find((r) => r.tabKey === 'agent:srv')?.isCurrent).toBe(false)
    // Tab id matching that of the active project's active tab but in a
    // different project does not count as current.
    expect(rows.find((r) => r.tabKey === 'cc:mem')?.isCurrent).toBe(false)
  })

  test('cwd is pulled from tabMeta when available', () => {
    const rows = build(['agent:dev'], {
      tabMeta: { 'agent:dev': { cwd: '/tmp/x' } },
    })
    expect(rows[0].cwd).toBe('/tmp/x')
  })

  test('lastActiveAt is forwarded from recencyTimes', () => {
    const rows = build(['agent:dev'], {
      recencyTimes: { 'agent:dev': 12345 },
    })
    expect(rows[0].lastActiveAt).toBe(12345)
    // never-visited tabs have undefined
    const docs = rows.find((r) => r.tabKey === 'cc:docs')
    expect(docs?.lastActiveAt).toBeUndefined()
  })

  test('label resolves to cwd basename when tab is not user-renamed', () => {
    // Matches sidebar behaviour — un-renamed tabs show the directory
    // path, not the auto-generated "shell"/"shell 2" labels.
    const rows = build(['agent:dev'], {
      tabMeta: { 'agent:dev': { cwd: '/Users/dani/Claude' } },
    })
    expect(rows[0].label).toBe('/Claude')
  })

  test('label is the raw tab.label when userRenamed is true (even with a cwd)', () => {
    const projects: Project[] = [
      {
        id: 'p',
        name: 'p',
        path: '~/p',
        pinned: false,
        tabs: [
          {
            id: 't1',
            label: 'my-named-tab',
            cmd: '',
            pinned: false,
            userRenamed: true,
          },
        ],
      },
    ]
    const rows = buildSwitcherRows({
      projects,
      recency: ['p:t1'],
      recencyTimes: {},
      tabMeta: { 'p:t1': { cwd: '/Users/dani/Claude' } },
      activeProjectId: '',
      activeTabIds: {},
    })
    expect(rows[0].label).toBe('my-named-tab')
  })

  test('label falls back to raw tab.label when no cwd is recorded', () => {
    const rows = build(['agent:dev'])
    expect(rows[0].label).toBe('dev')
  })
})
