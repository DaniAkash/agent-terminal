import { describe, expect, test } from 'bun:test'
import type { ProcessInfo, TabMeta } from '@/modules/stores/$tabMeta'
import type { Project } from '@/screens/workspace/workspace.types'
import {
  activeWorkForTab,
  collectActiveWork,
  describeWork,
  workReason,
} from './active-work'

const proc = (over: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 101,
  name: 'claude',
  command: 'claude "draft the notes"',
  memoryKb: 2048,
  elapsedTime: '4:12',
  listeningPorts: [],
  ...over,
})

const meta = (over: Partial<TabMeta> = {}): TabMeta => ({
  status: 'idle',
  type: 'shell',
  ...over,
})

const project: Project = {
  id: 'p1',
  name: 'control-center',
  path: '/p1',
  pinned: false,
  tabs: [
    { id: 't1', label: 'release notes', cmd: '', pinned: false },
    { id: 't2', label: 'idle shell', cmd: '', pinned: false },
  ],
}

describe('workReason', () => {
  test('an idle nested shell is not busy, but commands and agents still are', () => {
    expect(
      workReason(meta({ status: 'running', nestedShellIdle: true })),
    ).toBeNull()
    expect(
      workReason(
        meta({
          status: 'running',
          nestedShellIdle: false,
          processes: [proc({ name: 'ping' })],
        }),
      ),
    ).toBe('running')
    expect(
      workReason(meta({ nestedShellIdle: true, agentState: 'awaiting' })),
    ).toBe('awaiting')
  })
  test('idle, done and error are not work', () => {
    expect(workReason(meta())).toBeNull()
    expect(workReason(meta({ status: 'done' }))).toBeNull()
    expect(workReason(meta({ status: 'error', exitCode: 1 }))).toBeNull()
    expect(workReason(undefined)).toBeNull()
  })

  test('counts an agent parked on a question, which burns no CPU', () => {
    // The reason this is not a "is a process alive" check: the turn is
    // stopped, but closing the tab discards the question.
    expect(workReason(meta({ agentState: 'awaiting' }))).toBe('awaiting')
  })

  test('a waiting agent outranks its own live process', () => {
    expect(
      workReason(meta({ agentState: 'awaiting', processes: [proc()] })),
    ).toBe('awaiting')
  })

  test('counts a turn in flight, a tracked process, and a shell command', () => {
    expect(workReason(meta({ agentState: 'in-progress' }))).toBe('running')
    expect(workReason(meta({ processes: [proc()] }))).toBe('running')
    expect(workReason(meta({ status: 'running' }))).toBe('running')
  })
})

describe('describeWork', () => {
  test('names the agent when one is known', () => {
    expect(
      describeWork(
        meta({ agentState: 'awaiting', agentDisplayName: 'codex' }),
        'awaiting',
      ),
    ).toBe('codex, waiting on your answer')
    expect(
      describeWork(
        meta({ agentState: 'in-progress', agentDisplayName: 'claude' }),
        'running',
      ),
    ).toBe('claude, turn in flight')
  })

  test('falls back to "agent" rather than printing undefined', () => {
    expect(describeWork(meta({ agentState: 'in-progress' }), 'running')).toBe(
      'agent, turn in flight',
    )
  })

  test('shows the command for a tracked process, and its name when the command is empty', () => {
    expect(
      describeWork(
        meta({ processes: [proc({ command: 'cargo test' })] }),
        'running',
      ),
    ).toBe('cargo test')
    expect(
      describeWork(meta({ processes: [proc({ command: '' })] }), 'running'),
    ).toBe('claude')
  })

  test('truncates a pathological command instead of letting it push the buttons away', () => {
    const detail = describeWork(
      meta({ processes: [proc({ command: 'x'.repeat(400) })] }),
      'running',
    )
    expect(detail.length).toBe(120)
    expect(detail.endsWith('…')).toBe(true)
  })

  test('a plain shell has no command text to show', () => {
    expect(describeWork(meta({ status: 'running' }), 'running')).toBe(
      'running a command',
    )
  })
})

describe('activeWorkForTab', () => {
  test('carries the project and the elapsed time', () => {
    const work = activeWorkForTab(project, 't1', {
      'p1:t1': meta({
        agentState: 'in-progress',
        agentDisplayName: 'claude',
        processes: [proc()],
      }),
    })
    expect(work).toMatchObject({
      projectName: 'control-center',
      tabLabel: 'release notes',
      reason: 'running',
      detail: 'claude, turn in flight',
      elapsed: '4:12',
    })
  })

  test('is null for an idle tab and for a tab that does not exist', () => {
    expect(activeWorkForTab(project, 't2', {})).toBeNull()
    expect(activeWorkForTab(project, 'nope', {})).toBeNull()
  })
})

describe('collectActiveWork', () => {
  test('returns only busy tabs, in sidebar order', () => {
    const other: Project = {
      id: 'p2',
      name: 'agent-terminal',
      path: '/p2',
      pinned: false,
      tabs: [{ id: 't3', label: 'cargo test', cmd: '', pinned: false }],
    }
    const found = collectActiveWork([project, other], {
      'p1:t1': meta({ agentState: 'in-progress' }),
      'p1:t2': meta(),
      'p2:t3': meta({ status: 'running' }),
    })
    expect(found.map((w) => w.tabLabel)).toEqual([
      'release notes',
      'cargo test',
    ])
  })

  test('is empty when nothing runs, which is the no-dialog case', () => {
    expect(collectActiveWork([project], {})).toEqual([])
  })
})
