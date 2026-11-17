import { describe, expect, test } from 'bun:test'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import {
  activeTabInfo,
  activeTabSummary,
  rememberTab,
  remainingTabs,
  tabClosedOnDesktop,
} from './tab-info.helpers'

const NOW = 1_000_000_000

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
        agent_state_at: NOW - 1000,
      },
    ],
  },
] as unknown as ProjectSummary[]

describe('activeTabInfo', () => {
  test('reads the name, workspace and state off the tree', () => {
    const info = activeTabInfo(projects, 'p1', 'p1:claude', NOW)
    expect(info.label).toBe('claude')
    expect(info.projectName).toBe('browseros')
    expect(info.visual).toMatchObject({ kind: 'agent', state: 'awaiting' })
  })

  test('names a session the tree has not caught up with from its own id', () => {
    // Mid-switch the route changes before the next Projects frame lands; a
    // bar that blanks here reads as a bug even though nothing is wrong.
    const info = activeTabInfo(projects, 'p1', 'p1:brand-new', NOW)
    expect(info.label).toBe('brand-new')
    expect(info.visual).toMatchObject({ kind: 'shell', dot: 'idle' })
  })

  test('falls back to a generic name for an id it cannot even split', () => {
    expect(activeTabInfo(projects, 'p1', 'malformed', NOW).label).toBe(
      'session',
    )
  })

  test('leaves the workspace blank rather than inventing one', () => {
    expect(activeTabInfo(projects, 'p9', 'p9:x', NOW).projectName).toBe('')
  })

  test('an empty tree still produces a renderable result', () => {
    const info = activeTabInfo([], 'p1', 'p1:claude', NOW)
    expect(info.label).toBe('claude')
    expect(info.projectName).toBe('')
    expect(info.visual).toMatchObject({ kind: 'shell', dot: 'idle' })
  })
})

describe('activeTabSummary', () => {
  test('hands back the tree entry the glyph was derived from', () => {
    expect(activeTabSummary(projects, 'p1', 'p1:claude')).toMatchObject({
      agent_state: 'awaiting',
      agent_state_at: NOW - 1000,
    })
  })

  test('is undefined for a session the tree does not have', () => {
    expect(activeTabSummary(projects, 'p1', 'p1:gone')).toBeUndefined()
  })
})

describe('tabClosedOnDesktop', () => {
  const live = { connected: true, projectsLoaded: true, seen: true }

  test('a tab this screen saw that the tree no longer has was closed', () => {
    expect(tabClosedOnDesktop({ ...live, present: false })).toBe(true)
    expect(tabClosedOnDesktop({ ...live, present: true })).toBe(false)
  })

  test('a tab not seen yet (just created) is not closed', () => {
    expect(tabClosedOnDesktop({ ...live, seen: false, present: false })).toBe(
      false,
    )
  })

  test('a stale or missing tree decides nothing', () => {
    expect(
      tabClosedOnDesktop({ ...live, connected: false, present: false }),
    ).toBe(false)
    expect(
      tabClosedOnDesktop({ ...live, projectsLoaded: false, present: false }),
    ).toBe(false)
  })
})

describe('remainingTabs', () => {
  const tree = [
    {
      project_id: 'p0',
      name: 'other',
      tabs: [{ tab_id: 'p0:a', label: 'a', cwd: '/srv' }],
    },
    {
      project_id: 'p1',
      name: 'Project 1',
      tabs: [
        { tab_id: 'p1:home', label: 'shell', cwd: '/home/ubuntu' },
        { tab_id: 'p1:tmp', label: 'shell 2', cwd: '/tmp' },
        { tab_id: 'p1:log', label: 'shell 3', cwd: '/var/log' },
      ],
    },
  ] as unknown as ProjectSummary[]

  test('lists the closed tab’s workspace first, without the closed tab', () => {
    expect(remainingTabs(tree, 'p1', 'p1:home')).toEqual([
      {
        projectId: 'p1',
        tabId: 'p1:tmp',
        label: '/tmp',
        projectName: 'Project 1',
      },
      {
        projectId: 'p1',
        tabId: 'p1:log',
        label: '/log',
        projectName: 'Project 1',
      },
      { projectId: 'p0', tabId: 'p0:a', label: '/srv', projectName: 'other' },
    ])
  })

  test('nothing left, nothing listed', () => {
    expect(remainingTabs([], 'p1', 'p1:home')).toEqual([])
  })
})

describe('rememberTab', () => {
  test('keeps the name a closed tab had', () => {
    const seen = rememberTab(null, 'p1:home', '/home')
    expect(seen).toEqual({ tab: 'p1:home', label: '/home' })
    // The tree dropped the tab: the name stays.
    expect(rememberTab(seen, 'p1:home', null)).toBe(seen)
  })

  test('starts over for another tab, and follows a rename', () => {
    const seen = rememberTab(null, 'p1:home', '/home')
    expect(rememberTab(seen, 'p1:tmp', null)).toBeNull()
    expect(rememberTab(seen, 'p1:home', '/ubuntu')).toEqual({
      tab: 'p1:home',
      label: '/ubuntu',
    })
    expect(rememberTab(seen, 'p1:home', '/home')).toBe(seen)
  })
})
