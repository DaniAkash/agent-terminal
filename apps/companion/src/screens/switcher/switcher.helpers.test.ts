import { describe, expect, test } from 'bun:test'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import {
  headingAt,
  relativeAge,
  sectionHeading,
  switcherOrder,
} from './switcher.helpers'

const NOW = 1_000_000_000

function tab(
  projectId: string,
  rawId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    tab_id: `${projectId}:${rawId}`,
    label: rawId,
    ...extra,
  }
}

function tree(): ProjectSummary[] {
  return [
    {
      project_id: 'p1',
      name: 'browseros',
      is_expanded: true,
      tabs: [
        tab('p1', 'claude', { last_active_at: NOW - 60_000 }),
        tab('p1', 'tests', { last_active_at: NOW - 600_000 }),
        tab('p1', 'never'),
      ],
    },
    {
      project_id: 'p2',
      name: 'aalai',
      is_expanded: true,
      tabs: [
        tab('p2', 'codex', {
          last_active_at: NOW - 3_600_000,
          // agent_id matters: only an agent can be awaiting, so a tab
          // without one reads as a shell and never reaches the attention
          // section. The desktop never sends that combination.
          agent_id: 'claude-code',
          agent_state: 'awaiting',
        }),
      ],
    },
  ] as unknown as ProjectSummary[]
}

describe('switcherOrder', () => {
  test('a session waiting on an answer outranks everything more recent', () => {
    // codex was touched an hour ago and claude a minute ago, but codex is
    // the one that cannot make progress without the user.
    const rows = switcherOrder(tree(), NOW)
    expect(rows[0]?.key).toBe('p2:codex')
    expect(rows[0]?.section).toBe('attention')
  })

  test('the rest follow in most-recently-used order', () => {
    const rows = switcherOrder(tree(), NOW)
    expect(rows.slice(1).map((r) => r.key)).toEqual([
      'p1:claude',
      'p1:tests',
      'p1:never',
    ])
  })

  test('never-opened sessions sort last, whatever their tree position', () => {
    const rows = switcherOrder(tree(), NOW)
    expect(rows[rows.length - 1]).toMatchObject({
      key: 'p1:never',
      section: 'idle',
    })
  })

  test('ordering crosses projects rather than grouping by them', () => {
    const sections = switcherOrder(tree(), NOW).map((r) => r.projectId)
    // p2 first, then p1: the list is history, not a folder tree.
    expect(sections[0]).toBe('p2')
    expect(sections[1]).toBe('p1')
  })

  test('each row carries what the route needs, prefix already stripped', () => {
    const row = switcherOrder(tree(), NOW)[0]
    expect(row).toMatchObject({
      key: 'p2:codex',
      projectId: 'p2',
      tabId: 'codex',
      projectName: 'aalai',
    })
  })

  test('a finished turn still reads as recent, not as attention', () => {
    const t = [
      {
        project_id: 'p1',
        name: 'a',
        is_expanded: true,
        tabs: [
          tab('p1', 'done', {
            last_active_at: NOW,
            agent_state: 'done',
            agent_state_at: NOW,
          }),
        ],
      },
    ] as unknown as ProjectSummary[]
    expect(switcherOrder(t, NOW)[0]?.section).toBe('recent')
  })

  test('an empty tree yields no rows rather than throwing', () => {
    expect(switcherOrder([], NOW)).toEqual([])
  })
})

describe('relativeAge', () => {
  test('reads coarsely, because the exact second is never the question', () => {
    expect(relativeAge(NOW, NOW)).toBe('now')
    expect(relativeAge(NOW - 44_000, NOW)).toBe('now')
    expect(relativeAge(NOW - 90_000, NOW)).toBe('1m')
    expect(relativeAge(NOW - 3_600_000, NOW)).toBe('1h')
    expect(relativeAge(NOW - 86_400_000 * 3, NOW)).toBe('3d')
  })

  test('never rounds a real age down to zero', () => {
    expect(relativeAge(NOW - 59_000, NOW)).toBe('1m')
  })

  test('a session never opened has no age to show', () => {
    expect(relativeAge(undefined, NOW)).toBe('')
  })
})

describe('sectionHeading', () => {
  test('every section is labelled', () => {
    for (const s of ['attention', 'recent', 'idle'] as const) {
      expect(sectionHeading(s).length).toBeGreaterThan(0)
    }
  })
})

describe('headingAt', () => {
  const rows = switcherOrder(tree(), NOW)

  test('labels the first row of the list', () => {
    expect(headingAt(rows, 0)).toBe('attention')
  })

  test('labels a row that starts a new group', () => {
    const firstRecent = rows.findIndex((r) => r.section === 'recent')
    expect(headingAt(rows, firstRecent)).toBe('recent')
  })

  test('stays quiet inside a group that is already labelled', () => {
    const firstRecent = rows.findIndex((r) => r.section === 'recent')
    expect(headingAt(rows, firstRecent + 1)).toBeNull()
  })

  test('is null past the end rather than throwing', () => {
    expect(headingAt(rows, rows.length)).toBeNull()
    expect(headingAt([], 0)).toBeNull()
  })
})
