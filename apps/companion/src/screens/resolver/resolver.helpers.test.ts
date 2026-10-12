import { describe, expect, test } from 'bun:test'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import { landingInput, resolveLanding } from './resolver.helpers'

const projects = [
  {
    project_id: 'p1',
    name: 'browseros',
    is_expanded: true,
    tabs: [{ tab_id: 'p1:claude', label: 'claude' }],
  },
] as unknown as ProjectSummary[]

const base = {
  deviceLoaded: true,
  hasDevice: true,
  status: 'connected',
  projects,
  lastTabId: null,
}

describe('resolveLanding', () => {
  test('waits while the stored devices are still being read', () => {
    expect(resolveLanding({ ...base, deviceLoaded: false })).toBeNull()
  })

  test('sends an unpaired phone to pairing', () => {
    expect(resolveLanding({ ...base, hasDevice: false })).toBe('/pair')
  })

  test('waits while the socket is still coming up', () => {
    // The bug this guards: committing here lands every cold start on
    // home, because the first render always precedes the connection.
    expect(resolveLanding({ ...base, status: 'connecting' })).toBeNull()
    expect(resolveLanding({ ...base, status: 'disconnected' })).toBeNull()
  })

  test('stops waiting once the ladder has actually given up', () => {
    expect(resolveLanding({ ...base, status: 'unreachable' })).toBe('/home')
    expect(resolveLanding({ ...base, status: 'auth_failed' })).toBe('/home')
  })

  test('lands straight in the last session, the point of the resolver', () => {
    expect(resolveLanding({ ...base, lastTabId: 'p1:claude' })).toBe(
      '/tab/p1/claude',
    )
  })

  test('falls back when that session was deleted while the phone slept', () => {
    expect(resolveLanding({ ...base, lastTabId: 'p1:gone' })).toBe('/home')
  })

  test('falls back when the whole project is gone', () => {
    expect(resolveLanding({ ...base, lastTabId: 'p9:claude' })).toBe('/home')
  })

  test('falls back on an id that cannot address a tab', () => {
    expect(resolveLanding({ ...base, lastTabId: 'malformed' })).toBe('/home')
  })

  test('goes home when no session has been worked in yet', () => {
    expect(resolveLanding(base)).toBe('/home')
  })
})

describe('landingInput', () => {
  const session = { status: 'connected', projects }

  test('picks the last session belonging to the active desktop', () => {
    const input = landingInput(
      { loaded: true, record: { deviceId: 'd1' } },
      session,
      { d1: 'p1:claude', d2: 'p9:other' },
    )
    expect(input.lastTabId).toBe('p1:claude')
  })

  test('has no last session when this desktop has none recorded', () => {
    const input = landingInput(
      { loaded: true, record: { deviceId: 'd3' } },
      session,
      { d1: 'p1:claude' },
    )
    expect(input.lastTabId).toBeNull()
  })

  test('reports no device when nothing is paired', () => {
    const input = landingInput({ loaded: true, record: null }, session, {})
    expect(input.hasDevice).toBe(false)
    expect(input.lastTabId).toBeNull()
  })

  test('passes the status through rather than flattening to a boolean', () => {
    const input = landingInput(
      { loaded: true, record: { deviceId: 'd1' } },
      { status: 'connecting', projects },
      {},
    )
    expect(input.status).toBe('connecting')
  })
})
