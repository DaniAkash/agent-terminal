import { describe, expect, test } from 'bun:test'
import type { TabMeta } from '@/modules/stores/$tabMeta'
import type { Project } from '@/screens/workspace/workspace.types'
import {
  buildSyncPayload,
  resolveSyncAgentState,
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
      { 'p1:t1': meta({ status: 'running', doneAt: 1700 }) },
      { 'p1:t1': 1234, 'p1:t2': 99 },
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
    const [project] = buildSyncPayload(projects, {}, {})
    expect(project?.tabs[0]?.agentState).toBeUndefined()
    expect(project?.tabs[0]?.lastActiveAt).toBeUndefined()
  })

  test('preserves every original field, so the disk shape is never lost', () => {
    const [project] = buildSyncPayload(projects, {}, {})
    expect(project?.name).toBe('browseros')
    expect(project?.tabs[1]).toMatchObject({ label: 'tests', pinned: true })
  })

  test('does not mutate the input tree', () => {
    buildSyncPayload(projects, { 'p1:t1': meta({ status: 'error' }) }, {})
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
    )
    expect(out[0]?.tabs[0]?.agentState).toBeUndefined()
    expect(out[1]?.tabs[0]?.agentState).toBe('error')
  })
})
