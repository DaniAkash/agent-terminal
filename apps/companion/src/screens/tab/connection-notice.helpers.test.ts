import { describe, expect, test } from 'bun:test'
import {
  INITIAL_NOTICE_STATE,
  type NoticeState,
  nextNotice,
  renderNotice,
} from './connection-notice.helpers'

/** Feed a run of statuses through and collect everything that was said. */
function narrate(statuses: readonly string[], queued = 0): string[] {
  let state: NoticeState = INITIAL_NOTICE_STATE
  const said: string[] = []
  for (const status of statuses) {
    const out = nextNotice(state, status, queued)
    state = out.state
    if (out.notice) said.push(out.notice.text)
  }
  return said
}

describe('nextNotice', () => {
  test('says nothing on the first status seen', () => {
    // Arriving at a working terminal should not announce "reconnected" at
    // someone who was never disconnected.
    expect(narrate(['connected'])).toEqual([])
    expect(narrate(['unreachable'])).toEqual([])
  })

  test('says nothing while the status holds', () => {
    expect(narrate(['connected', 'connected', 'connected'])).toEqual([])
  })

  test('announces a dropped connection once', () => {
    const said = narrate(['connected', 'disconnected'])
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('queued')
  })

  test('announces an outage once, not once per retry', () => {
    // The regression this guards: the ladder cycles connecting/unreachable
    // while it retries, and narrating every transition printed the same
    // warning five times over the scrollback being read.
    const said = narrate([
      'connected',
      'disconnected',
      'connecting',
      'unreachable',
      'connecting',
      'unreachable',
      'connecting',
      'unreachable',
    ])
    expect(said).toHaveLength(1)
  })

  test('announces the outage even when it begins without a clean drop', () => {
    expect(narrate(['connecting', 'unreachable'])).toEqual([
      'desktop unreachable, still retrying',
    ])
  })

  test('reports coming back, and what is about to be replayed', () => {
    expect(narrate(['connected', 'disconnected', 'connected'], 0)).toEqual([
      'connection lost, keystrokes will be queued',
      'reconnected',
    ])
    const said = narrate(['connected', 'disconnected', 'connected'], 3)
    expect(said[1]).toContain('3 queued')
  })

  test('stays quiet about a reconnect the user never noticed', () => {
    // No outage was announced, so there is nothing to resolve.
    expect(narrate(['connecting', 'connected'])).toEqual([])
  })

  test('can narrate a second outage after recovering from the first', () => {
    const said = narrate([
      'connected',
      'disconnected',
      'connected',
      'disconnected',
      'connected',
    ])
    expect(said).toHaveLength(4)
  })

  test('raises the tone for a connection that gave up', () => {
    let state = nextNotice(INITIAL_NOTICE_STATE, 'connecting', 0).state
    expect(nextNotice(state, 'unreachable', 0).notice?.tone).toBe('alarm')
    state = nextNotice(INITIAL_NOTICE_STATE, 'connected', 0).state
    expect(nextNotice(state, 'auth_failed', 0).notice?.tone).toBe('alarm')
  })

  test('treats any departure from connected as a loss worth announcing', () => {
    // Deliberate: whatever a future status is called, leaving `connected`
    // means keystrokes start queuing, and the user should know that.
    expect(narrate(['connected', 'something-new'])).toEqual([
      'connection lost, keystrokes will be queued',
    ])
  })

  test('stays silent about an unknown status reached without a connection', () => {
    expect(narrate(['connecting', 'something-new'])).toEqual([])
  })
})

describe('renderNotice', () => {
  test('prints on its own line so it never lands mid-command', () => {
    const out = renderNotice({ text: 'reconnected', tone: 'dim' })
    expect(out.startsWith('\r\n')).toBe(true)
    expect(out.endsWith('\r\n')).toBe(true)
  })

  test('always closes the escape it opened', () => {
    for (const tone of ['dim', 'alarm'] as const) {
      expect(renderNotice({ text: 'x', tone })).toContain('\u001b[0m')
    }
  })

  test('distinguishes the two tones', () => {
    expect(renderNotice({ text: 'x', tone: 'dim' })).not.toBe(
      renderNotice({ text: 'x', tone: 'alarm' }),
    )
  })
})
