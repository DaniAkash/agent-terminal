import { describe, expect, test } from 'bun:test'
import type {
  ProjectSummary,
  TabStateSummary,
} from '@/modules/wss/protocol.gen'
import { sessionStatus, UNSET } from './status.helpers'

const NOW = 1_000_000_000
const TAB_ID = 'p1:claude'

function project(tabExtra: Record<string, unknown> = {}): ProjectSummary {
  return {
    project_id: 'p1',
    name: 'browseros',
    is_expanded: true,
    tabs: [{ tab_id: TAB_ID, label: 'claude', ...tabExtra }],
  } as unknown as ProjectSummary
}

function fieldValue(
  status: ReturnType<typeof sessionStatus>,
  label: string,
): string | undefined {
  return status?.fields.find((f) => f.label === label)?.value
}

describe('sessionStatus', () => {
  test('is null for a session the desktop no longer has', () => {
    expect(sessionStatus(project(), 'p1:gone', undefined, NOW)).toBeNull()
    expect(sessionStatus(undefined, TAB_ID, undefined, NOW)).toBeNull()
  })

  test('reports the state and how long it has held', () => {
    const s = sessionStatus(
      project({
        agent_id: 'claude-code',
        agent_state: 'awaiting',
        agent_state_at: NOW - 120_000,
      }),
      TAB_ID,
      undefined,
      NOW,
    )
    expect(s?.visual).toMatchObject({ kind: 'agent', state: 'awaiting' })
    expect(s?.state).toBe('needs you · 2m')
  })

  test('omits the age when the desktop never stamped one', () => {
    const s = sessionStatus(
      project({ agent_state: 'running' }),
      TAB_ID,
      undefined,
      NOW,
    )
    expect(s?.state).toBe('running')
  })

  test('prefers pushed tab_state over the periodic tree snapshot', () => {
    // The tree is a snapshot; tab_state is pushed when it changes, so it
    // is the fresher of the two wherever both carry a field.
    const state = {
      cwd: '/fresh',
      agent: 'codex',
      git_branch: 'feature',
      ports: [3000, 5173],
    } as TabStateSummary
    const s = sessionStatus(
      project({ last_cwd: '/stale', agent: 'claude' }),
      TAB_ID,
      state,
      NOW,
    )
    expect(fieldValue(s, 'Directory')).toBe('/fresh')
    expect(fieldValue(s, 'Agent')).toBe('codex')
    expect(fieldValue(s, 'Branch')).toBe('feature')
    expect(fieldValue(s, 'Ports')).toBe('3000, 5173')
  })

  test('falls back to the tree when nothing has been pushed yet', () => {
    const s = sessionStatus(
      project({ last_cwd: '/from-tree', agent_id: 'claude-code' }),
      TAB_ID,
      undefined,
      NOW,
    )
    expect(fieldValue(s, 'Directory')).toBe('/from-tree')
    expect(fieldValue(s, 'Agent')).toBe('claude-code')
  })

  test('marks a field the wire does not carry rather than leaving it blank', () => {
    const s = sessionStatus(project(), TAB_ID, undefined, NOW)
    expect(fieldValue(s, 'Branch')).toBe(UNSET)
    expect(fieldValue(s, 'Ports')).toBe(UNSET)
  })

  test('says plainly whether the session is running', () => {
    expect(
      fieldValue(
        sessionStatus(project({ is_spawned: true }), TAB_ID, undefined, NOW),
        'Running',
      ),
    ).toBe('yes')
    expect(
      fieldValue(sessionStatus(project(), TAB_ID, undefined, NOW), 'Running'),
    ).toBe('no, sleeping')
  })

  test('an empty port list reads as unset, not as an empty string', () => {
    const s = sessionStatus(
      project(),
      TAB_ID,
      { ports: [] } as TabStateSummary,
      NOW,
    )
    expect(fieldValue(s, 'Ports')).toBe(UNSET)
  })
})
