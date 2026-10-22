import { describe, expect, test } from 'bun:test'
import type { TabMeta } from '@/modules/stores/$tabMeta'
import type { Project } from '@/screens/workspace/workspace.types'
import {
  type AgentStateStamp,
  buildSyncPayload,
  resolveSyncAgentIdentity,
  resolveSyncAgentState,
  stampAgentStates,
} from './projects-sync.helpers'

function meta(partial: Partial<TabMeta>): TabMeta {
  return { status: 'idle', type: 'shell', ...partial }
}

const projects: Project[] = [
  {
    id: 'p1',
    name: 'browseros',
    path: '/tmp/browseros',
    pinned: false,
    tabs: [
      { id: 't1', label: 'claude', cmd: '', pinned: false },
      { id: 't2', label: 'tests', cmd: '', pinned: true },
    ],
  },
]

describe('resolveSyncAgentState', () => {
  test('is undefined when the tab has no meta at all', () => {
    expect(resolveSyncAgentState(undefined)).toBeUndefined()
  })

  test('agent turn state wins over shell status, so "awaiting" survives', () => {
    const m = meta({ status: 'running', type: 'agent', agentState: 'awaiting' })
    expect(resolveSyncAgentState(m)).toBe('awaiting')
  })

  test('in-progress and completed map onto the shell vocabulary', () => {
    expect(
      resolveSyncAgentState(meta({ type: 'agent', agentState: 'in-progress' })),
    ).toBe('running')
    expect(
      resolveSyncAgentState(meta({ type: 'agent', agentState: 'completed' })),
    ).toBe('done')
  })

  test('falls back to shell status when no agent turn is in flight', () => {
    expect(resolveSyncAgentState(meta({ status: 'error' }))).toBe('error')
    expect(
      resolveSyncAgentState(meta({ status: 'running', agentState: 'idle' })),
    ).toBe('running')
  })
})

describe('buildSyncPayload', () => {
  test('merges both stores onto the tree using the composed tab key', () => {
    const [project] = buildSyncPayload(
      projects,
      { 'p1:t1': meta({ status: 'running' }) },
      { 'p1:t1': 1234, 'p1:t2': 99 },
      { 'p1:t1': { state: 'running', at: 1700 } },
    )
    expect(project?.tabs[0]).toMatchObject({
      id: 't1',
      agentState: 'running',
      agentStateAt: 1700,
      lastActiveAt: 1234,
    })
    expect(project?.tabs[1]).toMatchObject({ id: 't2', lastActiveAt: 99 })
  })

  test('leaves the enriched fields undefined when neither store knows the tab', () => {
    const [project] = buildSyncPayload(projects, {}, {}, {})
    expect(project?.tabs[0]?.agentState).toBeUndefined()
    expect(project?.tabs[0]?.lastActiveAt).toBeUndefined()
  })

  test('preserves every original field, so the disk shape is never lost', () => {
    const [project] = buildSyncPayload(projects, {}, {}, {})
    expect(project?.name).toBe('browseros')
    expect(project?.tabs[1]).toMatchObject({ label: 'tests', pinned: true })
  })

  test('does not mutate the input tree', () => {
    buildSyncPayload(projects, { 'p1:t1': meta({ status: 'error' }) }, {}, {})
    expect('agentState' in (projects[0]?.tabs[0] ?? {})).toBe(false)
  })

  test('keys by project, so the same tab id under two projects stays distinct', () => {
    const two: Project[] = [
      projects[0] as Project,
      { ...(projects[0] as Project), id: 'p2', name: 'aalai' },
    ]
    const out = buildSyncPayload(
      two,
      { 'p2:t1': meta({ status: 'error' }) },
      {},
      {},
    )
    expect(out[0]?.tabs[0]?.agentState).toBeUndefined()
    expect(out[1]?.tabs[0]?.agentState).toBe('error')
  })
})

describe('stampAgentStates', () => {
  const running = { 'p1:t1': meta({ status: 'running' }) }

  test('stamps a tab the first time it carries a state', () => {
    const out = stampAgentStates(projects, running, {}, 1000)
    expect(out['p1:t1']).toEqual({ state: 'running', at: 1000 })
  })

  test('holds the original stamp while the state is unchanged', () => {
    const first = stampAgentStates(projects, running, {}, 1000)
    const second = stampAgentStates(projects, running, first, 5000)
    expect(second['p1:t1']?.at).toBe(1000)
  })

  test('re-stamps when the state changes', () => {
    const first = stampAgentStates(projects, running, {}, 1000)
    const awaiting = {
      'p1:t1': meta({ status: 'running', agentState: 'awaiting' as const }),
    }
    const second = stampAgentStates(projects, awaiting, first, 5000)
    expect(second['p1:t1']).toEqual({ state: 'awaiting', at: 5000 })
  })

  test('survives the done linger clearing doneAt, which it does not read', () => {
    const withDone = {
      'p1:t1': meta({ status: 'done', doneAt: 1000 }),
    }
    const first = stampAgentStates(projects, withDone, {}, 1000)
    const cleared = { 'p1:t1': meta({ status: 'done' }) }
    const second = stampAgentStates(projects, cleared, first, 20000)
    expect(second['p1:t1']).toEqual({ state: 'done', at: 1000 })
  })

  test('skips a tab with no meta, so the field stays absent on the wire', () => {
    expect(stampAgentStates(projects, {}, {}, 1000)).toEqual({})
  })

  test('drops a stamp once its tab leaves the tree', () => {
    const stale: Record<string, AgentStateStamp> = {
      'p1:gone': { state: 'running', at: 1000 },
    }
    const out = stampAgentStates(projects, running, stale, 2000)
    expect(out['p1:gone']).toBeUndefined()
  })
})

describe('resolveSyncAgentIdentity', () => {
  test('a shell tab claims no agent, so a tab that stops being one stops claiming', () => {
    expect(resolveSyncAgentIdentity(undefined)).toEqual({})
    expect(resolveSyncAgentIdentity(meta({ status: 'running' }))).toEqual({})
  })

  test('carries the registry id so mobile can pick the same brand mark', () => {
    const m = meta({ type: 'agent', agentId: 'claude-code' })
    expect(resolveSyncAgentIdentity(m).agentId).toBe('claude-code')
  })

  test('sends the permissions verdict, never the command that produced it', () => {
    const m = meta({
      type: 'agent',
      agentId: 'claude-code',
      agentCmd: 'claude --dangerously-skip-permissions --model opus',
    })
    const identity = resolveSyncAgentIdentity(m)

    expect(identity.fullPermissions).toBe(true)
    expect(JSON.stringify(identity)).not.toContain('--dangerously')
    expect(JSON.stringify(identity)).not.toContain('--model')
  })

  test('codex --yolo counts as full permissions too', () => {
    const m = meta({
      type: 'agent',
      agentId: 'codex',
      agentCmd: 'codex --yolo',
    })
    expect(resolveSyncAgentIdentity(m).fullPermissions).toBe(true)
  })

  test('an agent without the flag reports false rather than nothing', () => {
    const m = meta({ type: 'agent', agentId: 'codex', agentCmd: 'codex' })
    expect(resolveSyncAgentIdentity(m).fullPermissions).toBe(false)
  })
})

describe('buildSyncPayload agent identity', () => {
  test('the tree carries the id and the verdict, and no agent command', () => {
    const tabMeta: Record<string, TabMeta> = {
      'p1:t1': meta({
        type: 'agent',
        agentId: 'claude-code',
        agentCmd: 'claude --dangerously-skip-permissions',
      }),
    }
    const payload = buildSyncPayload(projects, tabMeta, {}, {})
    const [agentTab, shellTab] = payload[0]?.tabs ?? []

    expect(agentTab?.agentId).toBe('claude-code')
    expect(agentTab?.fullPermissions).toBe(true)
    expect(shellTab?.agentId).toBeUndefined()
    expect(shellTab?.fullPermissions).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain('--dangerously')
  })
})
