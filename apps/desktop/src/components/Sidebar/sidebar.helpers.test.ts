import { describe, expect, test } from 'bun:test'
import { groupByWorkspace, orderByRecency } from '@agent-terminal/core-ui'
import type { TabMeta } from '@/modules/stores/$tabMeta'
import type { Project } from '@/screens/workspace/workspace.types'
import { toSessionNodes } from './sidebar.helpers'

const NOW = 1_700_000_000_000

const projects: Project[] = [
  {
    id: 'p1',
    name: 'browseros',
    path: '/tmp/browseros',
    pinned: false,
    tabs: [
      { id: 'claude', label: 'claude', cmd: '', pinned: false },
      { id: 'shell', label: 'shell', cmd: '', pinned: true },
    ],
  },
  {
    id: 'p2',
    name: 'apps',
    path: '/tmp/apps',
    pinned: true,
    isExpanded: false,
    tabs: [{ id: 'dev', label: 'dev', cmd: '', pinned: false }],
  },
]

function nodes(over: Partial<Parameters<typeof toSessionNodes>[0]> = {}) {
  return toSessionNodes({
    projects,
    tabMeta: {},
    recencyTimes: {},
    activeProjectId: '',
    activeTabIds: {},
    now: NOW,
    ...over,
  })
}

describe('toSessionNodes', () => {
  test('flattens the tree into composed keys', () => {
    expect(nodes().map((n) => n.key)).toEqual([
      'p1:claude',
      'p1:shell',
      'p2:dev',
    ])
  })

  test('resolves the label the same way every surface shows it', () => {
    const tabMeta: Record<string, TabMeta> = {
      'p1:claude': { status: 'idle', type: 'shell', cwd: '/tmp/api' },
    }
    expect(nodes({ tabMeta })[0]?.label).toBe('/api')
  })

  test('derives the visual from the same adapter the wire uses', () => {
    const tabMeta: Record<string, TabMeta> = {
      'p1:claude': {
        status: 'running',
        type: 'agent',
        agentId: 'claude-code',
        agentState: 'awaiting',
        agentCmd: 'claude --dangerously-skip-permissions',
      },
    }
    expect(nodes({ tabMeta })[0]?.visual).toMatchObject({
      kind: 'agent',
      state: 'awaiting',
      showDanger: true,
    })
  })

  test('marks exactly the active tab of the active project as current', () => {
    const out = nodes({
      activeProjectId: 'p1',
      activeTabIds: { p1: 'shell', p2: 'dev' },
    })
    expect(out.filter((n) => n.isCurrent).map((n) => n.key)).toEqual([
      'p1:shell',
    ])
  })

  test('a project predating isExpanded reads as expanded', () => {
    const out = nodes()
    expect(out.find((n) => n.projectId === 'p1')?.projectExpanded).toBe(true)
    expect(out.find((n) => n.projectId === 'p2')?.projectExpanded).toBe(false)
  })
})

describe('the desktop adapter feeding the shared rules', () => {
  test('recency ordering crosses workspaces', () => {
    const rows = orderByRecency(
      nodes({
        recencyTimes: { 'p1:claude': 100, 'p2:dev': 300, 'p1:shell': 200 },
      }),
    )
    expect(rows.map((r) => r.key)).toEqual(['p2:dev', 'p1:shell', 'p1:claude'])
  })

  test('grouping puts the pinned workspace first and numbers from there', () => {
    const groups = groupByWorkspace(nodes())
    expect(groups.map((g) => g.projectName)).toEqual(['apps', 'browseros'])
    expect(groups.map((g) => g.position)).toEqual([1, 2])
  })

  test('grouping puts the pinned session first inside its workspace', () => {
    const groups = groupByWorkspace(nodes())
    const browseros = groups.find((g) => g.projectName === 'browseros')
    expect(browseros?.sessions.map((s) => s.tabId)).toEqual(['shell', 'claude'])
  })
})
