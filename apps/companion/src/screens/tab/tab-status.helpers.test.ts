import { describe, expect, test } from 'bun:test'
import { DONE_LINGER_MS } from '@agent-terminal/core-ui'
import type { TabSummary } from '@/modules/wss/protocol.gen'
import { doneExpiresAt, dotClass, tabVisualFor } from './tab-status.helpers'

const NOW = 1_700_000_000_000

function tab(partial: Partial<TabSummary>): TabSummary {
  return { tab_id: 'p1:t1', label: 'shell', ...partial }
}

describe('tabVisualFor', () => {
  test('a shell tab with no state at all reads idle rather than blank', () => {
    const visual = tabVisualFor(undefined, NOW)
    expect(visual).toMatchObject({ kind: 'shell', dot: 'idle', label: 'idle' })
  })

  test('reads the agent identity the desktop sent', () => {
    const visual = tabVisualFor(
      tab({
        agent_id: 'claude-code',
        agent_state: 'awaiting',
        full_permissions: true,
      }),
      NOW,
    )
    if (visual.kind !== 'agent') throw new Error('expected an agent visual')
    expect(visual.brand?.displayName).toBe('Claude Code')
    expect(visual.state).toBe('awaiting')
    expect(visual.showDanger).toBe(true)
    expect(visual.mark?.paths.length).toBeGreaterThan(0)
  })

  test('a tab with no agent id is a shell, whatever else it carries', () => {
    const visual = tabVisualFor(tab({ agent_state: 'running' }), NOW)
    expect(visual).toMatchObject({ kind: 'shell', dot: 'running' })
  })

  test('an unrecognised wire state reads idle rather than crashing the list', () => {
    // The field is a plain string on the wire. An older or newer desktop
    // sending something outside the vocabulary must not take out a list
    // the user is trying to scroll.
    const visual = tabVisualFor(tab({ agent_state: 'something-new' }), NOW)
    expect(visual).toMatchObject({ kind: 'shell', dot: 'idle' })
  })

  test('a finished command lingers, then goes out', () => {
    const lit = tabVisualFor(
      tab({ agent_state: 'done', agent_state_at: NOW - 1_000 }),
      NOW,
    )
    const gone = tabVisualFor(
      tab({ agent_state: 'done', agent_state_at: NOW - DONE_LINGER_MS - 1 }),
      NOW,
    )
    expect(lit).toMatchObject({ dot: 'done' })
    expect(gone).toMatchObject({ dot: 'idle' })
  })

  test('the session on screen is not dimmed, a row in the list is', () => {
    const onScreen = tabVisualFor(
      tab({ agent_id: 'codex', agent_state: 'idle' }),
      NOW,
      true,
    )
    const inList = tabVisualFor(
      tab({ agent_id: 'codex', agent_state: 'idle' }),
      NOW,
    )
    if (onScreen.kind !== 'agent' || inList.kind !== 'agent') {
      throw new Error('expected agent visuals')
    }
    expect(onScreen.dimmed).toBe(false)
    expect(inList.dimmed).toBe(true)
  })
})

describe('doneExpiresAt', () => {
  test('arms a timer for a lit shell dot', () => {
    expect(
      doneExpiresAt(tab({ agent_state: 'done', agent_state_at: NOW })),
    ).toBe(NOW + DONE_LINGER_MS)
  })

  test('nothing to arm for a running tab, an unstamped one, or an agent', () => {
    expect(doneExpiresAt(tab({ agent_state: 'running' }))).toBeNull()
    expect(doneExpiresAt(tab({ agent_state: 'done' }))).toBeNull()
    expect(
      doneExpiresAt(
        tab({
          agent_id: 'claude-code',
          agent_state: 'done',
          agent_state_at: NOW,
        }),
      ),
    ).toBeNull()
  })
})

describe('dotClass', () => {
  test('a waiting turn is the warning colour, which nothing else uses', () => {
    const visual = tabVisualFor(
      tab({ agent_id: 'claude-code', agent_state: 'awaiting' }),
      NOW,
    )
    expect(dotClass(visual)).toBe('bg-warning')
  })

  test('a failure is the destructive colour', () => {
    expect(dotClass(tabVisualFor(tab({ agent_state: 'error' }), NOW))).toBe(
      'bg-destructive',
    )
  })

  test('idle is deliberately low contrast', () => {
    expect(dotClass(tabVisualFor(undefined, NOW))).toBe(
      'bg-muted-foreground/40',
    )
  })
})
