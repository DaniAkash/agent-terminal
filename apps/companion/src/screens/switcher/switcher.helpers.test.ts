import { describe, expect, test } from 'bun:test'
import type { DeviceSessionsMap } from '@/modules/stores/$deviceSessions.helpers'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import {
  flattenGroups,
  headingAt,
  relativeAge,
  sectionHeading,
  switcherGroups,
  switcherListItemKey,
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

const DEVICES = [
  { deviceId: 'd1', deviceHint: 'RMX3750' },
  { deviceId: 'd2', deviceHint: 'Himanshus-MacBook-Pro-3' },
]

describe('switcherGroups', () => {
  test('the active device uses the live tree, not the cache', () => {
    const cache: DeviceSessionsMap = {
      d1: { projects: [], syncedAt: NOW - 1000 },
    }
    const groups = switcherGroups(DEVICES, 'd1', true, tree(), cache, NOW)
    const active = groups.find((g) => g.deviceId === 'd1')
    expect(active?.rows.map((r) => r.key)).toEqual(
      switcherOrder(tree(), NOW).map((r) => r.key),
    )
    expect(active?.connected).toBe(true)
    expect(active?.syncedAt).toBe(NOW)
  })

  test('a paired, non-active device falls back to its cached tree', () => {
    const cache: DeviceSessionsMap = {
      d2: { projects: tree(), syncedAt: NOW - 5000 },
    }
    const groups = switcherGroups(DEVICES, 'd1', true, [], cache, NOW)
    const other = groups.find((g) => g.deviceId === 'd2')
    expect(other?.rows.length).toBeGreaterThan(0)
    expect(other?.connected).toBe(false)
    expect(other?.syncedAt).toBe(NOW - 5000)
  })

  test('a paired device with nothing cached yet is empty, not missing', () => {
    const groups = switcherGroups(DEVICES, 'd1', true, [], {}, NOW)
    const other = groups.find((g) => g.deviceId === 'd2')
    expect(other?.rows).toEqual([])
    expect(other?.syncedAt).toBeNull()
  })

  test('the active device sorts first regardless of input order', () => {
    const groups = switcherGroups(DEVICES, 'd2', true, [], {}, NOW)
    expect(groups[0]?.deviceId).toBe('d2')
    expect(groups[1]?.deviceId).toBe('d1')
  })

  test('no active device at all: nothing is marked connected', () => {
    const groups = switcherGroups(DEVICES, null, true, tree(), {}, NOW)
    expect(groups.every((g) => g.connected === false)).toBe(true)
  })
})

describe('flattenGroups + switcherListItemKey', () => {
  function groupsOf(rowsByDevice: Record<string, ProjectSummary[]>) {
    return DEVICES.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceHint,
      connected: d.deviceId === 'd1',
      syncedAt: NOW,
      rows: switcherOrder(rowsByDevice[d.deviceId] ?? [], NOW),
    }))
  }

  test('every group gets a header, in order, even when empty', () => {
    const items = flattenGroups(groupsOf({}), new Set())
    const headers = items.filter((i) => i.type === 'device')
    expect(
      headers.map((i) => (i.type === 'device' ? i.group.deviceId : null)),
    ).toEqual(['d1', 'd2'])
  })

  test('an empty group renders a placeholder row instead of nothing', () => {
    const items = flattenGroups(groupsOf({}), new Set())
    expect(items.filter((i) => i.type === 'empty')).toHaveLength(2)
  })

  test('a collapsed device contributes only its header', () => {
    const items = flattenGroups(groupsOf({ d1: tree() }), new Set(['d1']))
    const forD1 = items.filter((i) =>
      i.type === 'device' ? i.group.deviceId === 'd1' : i.deviceId === 'd1',
    )
    expect(forD1).toHaveLength(1)
    expect(forD1[0]?.type).toBe('device')
  })

  test('section headings still appear once per run inside a device group', () => {
    const items = flattenGroups(groupsOf({ d1: tree() }), new Set())
    const headings = items.filter((i) => i.type === 'heading')
    expect(
      headings.map((h) => (h.type === 'heading' ? h.section : null)),
    ).toEqual(['attention', 'recent', 'idle'])
  })

  test('every item produces a unique, stable key, even across devices with identical ids', () => {
    // Two different desktops' project/tab ids are not coordinated with
    // each other, so the same tree on both is the realistic worst case
    // for key collisions, not a contrived one.
    const items = flattenGroups(groupsOf({ d1: tree(), d2: tree() }), new Set())
    const keys = items.map(switcherListItemKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('a row key is scoped to its device, not just its tab id', () => {
    const items = flattenGroups(groupsOf({ d1: tree(), d2: tree() }), new Set())
    const rowKeys = items
      .filter((i) => i.type === 'row')
      .map(switcherListItemKey)
    expect(rowKeys).toContain('row:d1:p2:codex')
    expect(rowKeys).toContain('row:d2:p2:codex')
  })
})
