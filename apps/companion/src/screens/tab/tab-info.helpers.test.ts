import { describe, expect, test } from 'bun:test'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import { activeStateStamp, activeTabInfo } from './tab-info.helpers'

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
        agent_state: 'awaiting',
        agent_state_at: NOW - 1000,
      },
    ],
  },
] as unknown as ProjectSummary[]

describe('activeTabInfo', () => {
  test('reads the name, workspace and state off the tree', () => {
    expect(activeTabInfo(projects, 'p1', 'p1:claude', NOW)).toEqual({
      label: 'claude',
      projectName: 'browseros',
      glyph: 'awaiting',
    })
  })

  test('names a session the tree has not caught up with from its own id', () => {
    // Mid-switch the route changes before the next Projects frame lands; a
    // bar that blanks here reads as a bug even though nothing is wrong.
    expect(activeTabInfo(projects, 'p1', 'p1:brand-new', NOW)).toMatchObject({
      label: 'brand-new',
      glyph: 'idle',
    })
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
    expect(activeTabInfo([], 'p1', 'p1:claude', NOW)).toEqual({
      label: 'claude',
      projectName: '',
      glyph: 'idle',
    })
  })
})

describe('activeStateStamp', () => {
  test('reports the stamp the glyph was derived from', () => {
    expect(activeStateStamp(projects, 'p1', 'p1:claude')).toEqual({
      state: 'awaiting',
      at: NOW - 1000,
    })
  })

  test('is empty for a session the tree does not have', () => {
    expect(activeStateStamp(projects, 'p1', 'p1:gone')).toEqual({
      state: undefined,
      at: undefined,
    })
  })
})
