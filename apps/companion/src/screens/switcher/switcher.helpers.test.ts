import { describe, expect, test } from 'bun:test'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import {
  recentSessions,
  relativeAge,
  rowSpokenLabel,
  spokenAge,
  toSessionNodes,
  workspaceGroups,
} from './switcher.helpers'
import { switcherItems, toggleWorkspace } from './switcher.list'

const NOW = 1_700_000_000_000

const projects = [
  {
    project_id: 'p1',
    name: 'browseros',
    is_expanded: true,
    tabs: [
      {
        tab_id: 'p1:claude',
        label: 'claude',
        agent_id: 'claude-code',
        agent_state: 'awaiting',
        last_active_at: NOW - 60_000,
      },
      {
        tab_id: 'p1:shell',
        label: 'shell',
        pinned: true,
        last_active_at: NOW - 600_000,
      },
      { tab_id: 'p1:never', label: 'never' },
    ],
  },
  {
    project_id: 'p2',
    name: 'apps',
    pinned: true,
    is_expanded: false,
    tabs: [{ tab_id: 'p2:dev', label: 'dev', last_active_at: NOW - 10_000 }],
  },
] as unknown as ProjectSummary[]

const nodes = () => toSessionNodes(projects, 'p1:claude', NOW)

describe('toSessionNodes', () => {
  test('keeps the composed wire id and strips it for the route', () => {
    const claude = nodes().find((n) => n.key === 'p1:claude')
    expect(claude?.tabId).toBe('claude')
    expect(claude?.projectId).toBe('p1')
  })

  test('reads the agent identity the desktop sent', () => {
    expect(nodes()[0]?.visual).toMatchObject({
      kind: 'agent',
      state: 'awaiting',
    })
  })

  test('marks the session behind the sheet as current', () => {
    expect(
      nodes()
        .filter((n) => n.isCurrent)
        .map((n) => n.key),
    ).toEqual(['p1:claude'])
  })

  test('carries the desktop expand state rather than inventing one', () => {
    const byProject = nodes()
    expect(byProject.find((n) => n.projectId === 'p1')?.projectExpanded).toBe(
      true,
    )
    expect(byProject.find((n) => n.projectId === 'p2')?.projectExpanded).toBe(
      false,
    )
  })
})

describe('recentSessions', () => {
  test('most recent first, across workspaces, never-opened dropped', () => {
    expect(recentSessions(nodes()).map((r) => r.key)).toEqual([
      'p2:dev',
      'p1:claude',
      'p1:shell',
    ])
  })
})

describe('workspaceGroups', () => {
  test('pinned workspace leads and sessions keep tree order under it', () => {
    const groups = workspaceGroups(nodes())
    expect(groups.map((g) => g.projectName)).toEqual(['apps', 'browseros'])
    expect(groups[1]?.sessions.map((s) => s.tabId)).toEqual([
      'shell',
      'claude',
      'never',
    ])
  })
})

describe('switcherItems', () => {
  test('the recent view is a flat list with no workspace headers', () => {
    const items = switcherItems(nodes(), 'recent', new Set())
    expect(items.every((i) => i.type === 'session')).toBe(true)
    expect(items).toHaveLength(3)
  })

  test('the workspaces view puts a header above each workspace', () => {
    const items = switcherItems(nodes(), 'workspaces', new Set())
    expect(items[0]).toMatchObject({ type: 'workspace' })
  })

  test('a workspace the desktop folded contributes only its header', () => {
    const items = switcherItems(nodes(), 'workspaces', new Set())
    // p2 is pinned so it leads, and is_expanded is false on the wire.
    expect(items[0]).toMatchObject({ type: 'workspace' })
    expect(items[1]).toMatchObject({ type: 'workspace' })
  })

  test('the recent view keeps never-opened sessions out, workspaces keeps them in', () => {
    const recent = switcherItems(nodes(), 'recent', new Set())
    const tree = switcherItems(nodes(), 'workspaces', new Set())
    const keys = (items: typeof recent) =>
      items.filter((i) => i.type === 'session').map((i) => i.node.key)
    expect(keys(recent)).not.toContain('p1:never')
    expect(keys(tree)).toContain('p1:never')
  })

  test('an empty tree still produces something renderable', () => {
    expect(switcherItems([], 'workspaces', new Set())).toEqual([
      { type: 'empty' },
    ])
    expect(switcherItems([], 'recent', new Set())).toEqual([{ type: 'empty' }])
  })
})

describe('toggleWorkspace', () => {
  test('opens one the desktop folded, and folds it again', () => {
    const groups = workspaceGroups(nodes())
    const folded = groups.find((g) => g.projectId === 'p2')
    if (!folded) throw new Error('expected the folded workspace')

    const opened = toggleWorkspace(new Set(), folded)
    expect(
      switcherItems(nodes(), 'workspaces', opened).filter(
        (i) => i.type === 'session' && i.node.projectId === 'p2',
      ),
    ).toHaveLength(1)

    const reclosed = toggleWorkspace(opened, { ...folded, expanded: true })
    expect(
      switcherItems(nodes(), 'workspaces', reclosed).filter(
        (i) => i.type === 'session' && i.node.projectId === 'p2',
      ),
    ).toHaveLength(0)
  })

  test('folds one the desktop left open', () => {
    const groups = workspaceGroups(nodes())
    const open = groups.find((g) => g.projectId === 'p1')
    if (!open) throw new Error('expected the open workspace')

    const next = toggleWorkspace(new Set(), open)
    expect(
      switcherItems(nodes(), 'workspaces', next).filter(
        (i) => i.type === 'session' && i.node.projectId === 'p1',
      ),
    ).toHaveLength(0)
  })
})

describe('relativeAge', () => {
  test('is blank for a session never opened', () => {
    expect(relativeAge(undefined, NOW)).toBe('')
  })

  test('coarse by design: now, minutes, hours, days', () => {
    expect(relativeAge(NOW - 10_000, NOW)).toBe('now')
    expect(relativeAge(NOW - 5 * 60_000, NOW)).toBe('5m')
    expect(relativeAge(NOW - 3 * 3_600_000, NOW)).toBe('3h')
    expect(relativeAge(NOW - 2 * 86_400_000, NOW)).toBe('2d')
  })

  test('a stamp from a faster clock reads now rather than going negative', () => {
    expect(relativeAge(NOW + 5_000, NOW)).toBe('now')
  })
})

describe('the spoken age in a row label', () => {
  // Caught on a device: the column reads "now", and the label appended
  // "ago" to whatever it held, so a just-used session announced itself as
  // "now ago".
  test('a recent session is "just now", never "now ago"', () => {
    expect(relativeAge(NOW - 1_000, NOW)).toBe('now')
    expect(spokenAge('now')).toBe(', just now')
  })

  test('every other age keeps its "ago"', () => {
    expect(spokenAge('5m')).toBe(', 5m ago')
    expect(spokenAge('')).toBe('')
  })
})

describe('rowSpokenLabel', () => {
  const pinnedShell = () => {
    const node = nodes().find((n) => n.key === 'p1:shell')
    if (!node) throw new Error('fixture missing the pinned shell')
    return node
  }

  // The pin is drawn only in the Workspaces view, because Recent orders
  // by recency and a pin there would describe a rule it does not use. A
  // row that shows no pin must not speak one either.
  test('speaks the pin only where the row draws one', () => {
    expect(rowSpokenLabel(pinnedShell(), '', true)).toContain(', pinned')
    expect(rowSpokenLabel(pinnedShell(), '10m', false)).not.toContain('pinned')
  })

  test('names the agent and its permissions before the workspace', () => {
    const claude = nodes().find((n) => n.key === 'p1:claude')
    if (!claude) throw new Error('fixture missing the claude session')
    expect(rowSpokenLabel(claude, '1m')).toBe(
      'claude, Claude Code, needs you, in browseros, 1m ago',
    )
  })
})
