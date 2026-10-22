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
  projectsLoaded: true,
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

  test('waits for the project tree, which arrives after the connection', () => {
    // The bug this guards: auth_ok flips status to connected before the
    // Projects frame lands, so resolving here reads an empty tree and sends
    // every launch home instead of back to the saved session.
    expect(
      resolveLanding({
        ...base,
        projectsLoaded: false,
        lastTabId: 'p1:claude',
      }),
    ).toBeNull()
  })

  test('treats an empty tree as an answer once the frame has landed', () => {
    expect(resolveLanding({ ...base, projects: [], lastTabId: null })).toBe(
      '/home',
    )
  })

  test('does not resolve against the previous connection stale tree', () => {
    // A reconnect keeps `projects` so the UI does not blank out, but the saved
    // tab must be re-confirmed against the new tree before being deep linked.
    expect(
      resolveLanding({
        ...base,
        status: 'connected',
        projectsLoaded: false,
        lastTabId: 'p1:claude',
      }),
    ).toBeNull()
  })

  test('stops waiting once the ladder has actually given up', () => {
    expect(resolveLanding({ ...base, status: 'unreachable' })).toBe('/home')
    expect(resolveLanding({ ...base, status: 'auth_failed' })).toBe('/home')
    // A terminal failure never waits for a tree that will not arrive.
    expect(
      resolveLanding({
        ...base,
        status: 'unreachable',
        projectsLoaded: false,
      }),
    ).toBe('/home')
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
  const session = { status: 'connected', projects, projectsLoaded: true }

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
      { status: 'connecting', projects, projectsLoaded: false },
      {},
    )
    expect(input.status).toBe('connecting')
  })

  test('passes the tree-loaded flag through', () => {
    const input = landingInput(
      { loaded: true, record: { deviceId: 'd1' } },
      { status: 'connected', projects, projectsLoaded: false },
      {},
    )
    expect(input.projectsLoaded).toBe(false)
  })
})
