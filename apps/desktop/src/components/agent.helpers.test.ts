import { describe, expect, test } from 'bun:test'
import { deriveTabVisual } from '@agent-terminal/core-ui'
import type { TabMeta } from '@/modules/stores/$tabMeta'
import {
  hasDangerFlag,
  parseModelFlag,
  tabAgentIdentity,
  tabVisualInput,
  tabWireState,
} from './agent.helpers'

function meta(partial: Partial<TabMeta>): TabMeta {
  return { status: 'idle', type: 'shell', ...partial }
}

describe('hasDangerFlag', () => {
  test('detects claude --dangerously-skip-permissions', () => {
    expect(hasDangerFlag('claude --dangerously-skip-permissions')).toBe(true)
  })

  test('detects codex --yolo', () => {
    expect(hasDangerFlag('codex --yolo')).toBe(true)
  })

  test('returns false for a plain agent invocation', () => {
    expect(hasDangerFlag('claude')).toBe(false)
    expect(hasDangerFlag('codex --sandbox')).toBe(false)
  })

  test('returns false for undefined', () => {
    expect(hasDangerFlag(undefined)).toBe(false)
  })
})

describe('parseModelFlag', () => {
  test('extracts the model name after --model', () => {
    expect(parseModelFlag('claude --model claude-opus-4-5')).toBe(
      'claude-opus-4-5',
    )
  })

  test('returns null when the flag is missing', () => {
    expect(parseModelFlag('claude')).toBeNull()
  })

  test('returns null for undefined', () => {
    expect(parseModelFlag(undefined)).toBeNull()
  })
})

describe('tabWireState, shell tabs', () => {
  test('is undefined when the tab has no meta at all', () => {
    expect(tabWireState(undefined)).toBeUndefined()
  })

  test('reports the shell status directly', () => {
    expect(tabWireState(meta({ status: 'running' }))).toBe('running')
    expect(tabWireState(meta({ status: 'error' }))).toBe('error')
    expect(tabWireState(meta({ status: 'idle' }))).toBe('idle')
  })

  test('a done that has been acknowledged reads idle', () => {
    // mod-listener's ten second timer, or the user navigating to the tab,
    // clears doneAt. Either way the dot has had its moment.
    expect(tabWireState(meta({ status: 'done', doneAt: 1 }))).toBe('done')
    expect(tabWireState(meta({ status: 'done' }))).toBe('idle')
  })
})

describe('tabWireState, agent tabs', () => {
  test('the turn state wins, so "awaiting" survives', () => {
    const m = meta({ status: 'running', type: 'agent', agentState: 'awaiting' })
    expect(tabWireState(m)).toBe('awaiting')
  })

  test('in-progress and completed map onto the shell vocabulary', () => {
    expect(
      tabWireState(meta({ type: 'agent', agentState: 'in-progress' })),
    ).toBe('running')
    expect(tabWireState(meta({ type: 'agent', agentState: 'completed' }))).toBe(
      'done',
    )
  })

  test('an idle turn stays idle even while the shell is busy', () => {
    // The hook is the better witness. A live shell under an agent that
    // reports no turn is the agent sitting at its prompt.
    const m = meta({ status: 'running', type: 'agent', agentState: 'idle' })
    expect(tabWireState(m)).toBe('idle')
  })

  test('without hook data a running shell does not claim a turn', () => {
    // OSC 133 says the shell is alive, which is not the same as the agent
    // producing output. Claiming "running" here would be a guess.
    expect(tabWireState(meta({ status: 'running', type: 'agent' }))).toBe(
      'idle',
    )
  })

  test('both exits read as a finished turn', () => {
    // Nothing at the OSC 133 level separates a clean agent exit from a
    // failed one, so neither is claimed over the other.
    expect(tabWireState(meta({ status: 'done', type: 'agent' }))).toBe('done')
    expect(tabWireState(meta({ status: 'error', type: 'agent' }))).toBe('done')
  })
})

describe('tabAgentIdentity', () => {
  test('a shell claims no agent', () => {
    expect(tabAgentIdentity(undefined)).toEqual({})
    expect(tabAgentIdentity(meta({ status: 'running' }))).toEqual({})
  })

  test('carries the registry id and the permissions verdict', () => {
    const m = meta({
      type: 'agent',
      agentId: 'claude-code',
      agentCmd: 'claude --dangerously-skip-permissions',
    })
    expect(tabAgentIdentity(m)).toEqual({
      agentId: 'claude-code',
      fullPermissions: true,
    })
  })

  test('never carries the command that produced the verdict', () => {
    const m = meta({
      type: 'agent',
      agentId: 'codex',
      agentCmd: 'codex --yolo --api-key sk-not-a-real-key',
    })
    expect(JSON.stringify(tabAgentIdentity(m))).not.toContain('sk-')
  })
})

describe('what the desktop draws is what the desktop sends', () => {
  // The whole point of routing both through one adapter. If these ever
  // diverge, the two apps can disagree about the same session while each
  // stays internally consistent, which is the failure the shared package
  // exists to prevent.
  const cases: Array<[string, TabMeta]> = [
    ['running shell', meta({ status: 'running' })],
    ['finished shell', meta({ status: 'done', doneAt: 1 })],
    ['acknowledged shell', meta({ status: 'done' })],
    ['failed shell', meta({ status: 'error' })],
    [
      'waiting agent',
      meta({ type: 'agent', agentId: 'claude-code', agentState: 'awaiting' }),
    ],
    [
      'working agent',
      meta({ type: 'agent', agentId: 'codex', agentState: 'in-progress' }),
    ],
    [
      'dangerous agent',
      meta({
        type: 'agent',
        agentId: 'claude-code',
        agentState: 'idle',
        agentCmd: 'claude --dangerously-skip-permissions',
      }),
    ],
  ]

  for (const [name, m] of cases) {
    test(`${name} derives one state for both paths`, () => {
      const drawn = tabVisualInput(m)
      const sent = { state: tabWireState(m), ...tabAgentIdentity(m) }

      expect(drawn.state).toBe(sent.state as never)
      expect(drawn.agentId).toBe(sent.agentId)
      expect(drawn.fullPermissions).toBe(sent.fullPermissions)
    })
  }

  test('the visual the desktop draws is the one mobile derives from the wire', () => {
    const m = meta({
      type: 'agent',
      agentId: 'claude-code',
      agentState: 'awaiting',
      agentCmd: 'claude --dangerously-skip-permissions',
    })
    const now = 1_700_000_000_000

    const desktop = deriveTabVisual(tabVisualInput(m), now)
    // Exactly what Rust forwards and the companion reads back.
    const mobile = deriveTabVisual(
      {
        state: tabWireState(m) ?? 'idle',
        ...tabAgentIdentity(m),
      },
      now,
    )

    expect(desktop).toEqual(mobile)
  })
})
