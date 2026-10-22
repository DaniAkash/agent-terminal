import { describe, expect, test } from 'bun:test'
import { deriveTabVisual, doneExpiresAt, hasDangerFlag } from './agent.helpers'
import { AGENT_MARKS } from './agent.marks'
import { AGENT_BRANDS, FULL_PERMISSION_FLAGS } from './agent.registry'
import { DONE_LINGER_MS, type WireTabState } from './agent.types'

const NOW = 1_700_000_000_000

/** Derive and narrow, so a test reading `.dot` fails loudly on a wrong kind. */
function shell(input: Parameters<typeof deriveTabVisual>[0]) {
  const visual = deriveTabVisual(input, NOW)
  if (visual.kind !== 'shell') throw new Error('expected a shell visual')
  return visual
}

function agent(input: Parameters<typeof deriveTabVisual>[0]) {
  const visual = deriveTabVisual(input, NOW)
  if (visual.kind !== 'agent') throw new Error('expected an agent visual')
  return visual
}

describe('hasDangerFlag', () => {
  test('no command means no claim either way', () => {
    expect(hasDangerFlag(undefined)).toBe(false)
    expect(hasDangerFlag('')).toBe(false)
  })

  test('recognises every flag any agent declares', () => {
    for (const flag of FULL_PERMISSION_FLAGS) {
      expect(hasDangerFlag(`some-agent ${flag}`)).toBe(true)
    }
  })

  test('a plain agent command is not dangerous', () => {
    expect(hasDangerFlag('claude --model opus')).toBe(false)
    expect(hasDangerFlag('codex')).toBe(false)
  })
})

describe('deriveTabVisual, shell tabs', () => {
  test('a running command pulses, an idle one does not', () => {
    const running = shell({ state: 'running' })
    expect(running).toMatchObject({
      kind: 'shell',
      dot: 'running',
      pulses: true,
    })
    expect(shell({ state: 'idle' }).pulses).toBe(false)
  })

  test('a finished command lingers, then goes out', () => {
    const lit = shell({ state: 'done', stateAt: NOW - 1_000 })
    expect(lit).toMatchObject({ dot: 'done', label: 'done' })

    const expired = shell({ state: 'done', stateAt: NOW - DONE_LINGER_MS - 1 })
    expect(expired).toMatchObject({ dot: 'idle', label: 'idle' })
  })

  test('an unstamped done stays lit rather than guessing', () => {
    // What a tree loaded from disk looks like before the first sync.
    expect(shell({ state: 'done' }).dot).toBe('done')
  })

  test('a failure does not expire, because it is still actionable', () => {
    const old = shell({ state: 'error', stateAt: NOW - DONE_LINGER_MS * 100 })
    expect(old).toMatchObject({ dot: 'error', label: 'failed' })
  })

  test('a shell never shows the permissions badge', () => {
    expect(shell({ state: 'running', fullPermissions: true }).showDanger).toBe(
      false,
    )
  })
})

describe('deriveTabVisual, agent tabs', () => {
  test('carries the brand and the geometry for a known agent', () => {
    const visual = agent({ agentId: 'claude-code', state: 'running' })
    expect(visual.art?.brand.displayName).toBe('Claude Code')
    expect(visual.art?.mark.paths.length).toBeGreaterThan(0)
  })

  test('an unknown agent degrades to no brand rather than throwing', () => {
    const visual = agent({ agentId: 'some-future-agent', state: 'idle' })
    expect(visual.art).toBeNull()
    expect(visual.agentId).toBe('some-future-agent')
  })

  test('maps each wire state onto one badge', () => {
    const cases: Array<[WireTabState, string]> = [
      ['awaiting', 'awaiting'],
      ['running', 'in-progress'],
      ['done', 'completed'],
      ['error', 'completed'],
      ['idle', 'idle'],
    ]
    for (const [wire, expected] of cases) {
      expect(agent({ agentId: 'codex', state: wire }).state).toBe(
        expected as never,
      )
    }
  })

  test('a finished turn does NOT expire the way a finished command does', () => {
    // An exited command is news for a few seconds. An agent that finished
    // its turn is something still waiting to be read, so it stays marked.
    const ancient = agent({
      agentId: 'claude-code',
      state: 'done',
      stateAt: NOW - DONE_LINGER_MS * 1000,
    })
    expect(ancient.state).toBe('completed')
  })

  test('an idle mark dims unless the session is the one on screen', () => {
    const background = agent({ agentId: 'codex', state: 'idle' })
    const onScreen = agent({ agentId: 'codex', state: 'idle', active: true })
    expect(background.dimmed).toBe(true)
    expect(onScreen.dimmed).toBe(false)
  })

  test('the permissions badge follows the verdict the desktop sent', () => {
    const yes = agent({
      agentId: 'claude-code',
      state: 'running',
      fullPermissions: true,
    })
    const no = agent({
      agentId: 'claude-code',
      state: 'running',
      fullPermissions: false,
    })
    expect(yes.showDanger).toBe(true)
    expect(no.showDanger).toBe(false)
  })
})

describe('doneExpiresAt', () => {
  test('arms a timer only for a lit shell dot', () => {
    expect(doneExpiresAt({ state: 'done', stateAt: NOW })).toBe(
      NOW + DONE_LINGER_MS,
    )
    expect(doneExpiresAt({ state: 'running', stateAt: NOW })).toBeNull()
    expect(doneExpiresAt({ state: 'done' })).toBeNull()
  })

  test('an agent has nothing to expire', () => {
    expect(
      doneExpiresAt({ agentId: 'claude-code', state: 'done', stateAt: NOW }),
    ).toBeNull()
  })
})

describe('the agent registry and the mark table stay in step', () => {
  test('every brand has geometry and every mark has a brand', () => {
    expect(Object.keys(AGENT_MARKS).sort()).toEqual(
      Object.keys(AGENT_BRANDS).sort(),
    )
  })

  test('every mark is drawable', () => {
    for (const [id, mark] of Object.entries(AGENT_MARKS)) {
      expect(mark.viewBox, `${id} viewBox`).toMatch(
        /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/,
      )
      expect(mark.paths.length, `${id} path count`).toBeGreaterThan(0)
      for (const d of mark.paths) {
        // Every path must open with a move, or the renderer draws from
        // wherever the previous one ended. This is the check that catches
        // a rect or polygon converted by hand and left headless.
        //
        // Not asserting a trailing `Z`: a fill implicitly closes its
        // subpaths, and some of this artwork is authored without one.
        expect(d.trimStart()[0], `${id} path start`).toMatch(/[Mm]/)
        expect(d, `${id} path commands`).toMatch(/[0-9]/)
        expect(d, `${id} is geometry, not markup`).not.toContain('<')
      }
    }
  })
})
