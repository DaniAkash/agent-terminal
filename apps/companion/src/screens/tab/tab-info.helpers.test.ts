import { describe, expect, test } from 'bun:test'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import { activeTabInfo, activeTabSummary } from './tab-info.helpers'

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
