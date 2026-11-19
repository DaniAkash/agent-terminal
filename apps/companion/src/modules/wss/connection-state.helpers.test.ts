import { describe, expect, test } from 'bun:test'
import {
  chipRoute,
  clock,
  connectionBanner,
  connectionCopy,
  connectionDetails,
  connectionState,
  connectionView,
  RECONNECTING_MS,
} from './connection-state.helpers'

const base = { status: 'connecting', downSince: null, removed: false, now: 0 }

describe('connectionState', () => {
  test('a cold start is Connecting until the ladder gives up', () => {
    expect(connectionState(base)).toBe('connecting')
    expect(connectionState({ ...base, status: 'unreachable' })).toBe(
      'unreachable',
    )
  })

  test('connected is Connected', () => {
    expect(connectionState({ ...base, status: 'connected' })).toBe('connected')
  })

  test('a lost connection is Reconnecting for 30 s, then Unreachable', () => {
    const lost = { ...base, status: 'unreachable', downSince: 1_000 }
    expect(connectionState({ ...lost, now: 1_000 })).toBe('reconnecting')
    // The socket cycles connecting and unreachable while it retries; the
    // state does not flicker with it.
    expect(
      connectionState({ ...lost, status: 'connecting', now: 20_000 }),
    ).toBe('reconnecting')
    expect(connectionState({ ...lost, now: 1_000 + RECONNECTING_MS })).toBe(
      'unreachable',
    )
  })

  test('removed outranks everything', () => {
    expect(
      connectionState({ ...base, status: 'connected', removed: true }),
    ).toBe('removed')
  })
})

describe('connectionCopy', () => {
  test('never says Wi-Fi when the route is Tailscale', () => {
    for (const state of [
      'connecting',
      'reconnecting',
      'unreachable',
    ] as const) {
      const copy = connectionCopy(state, 'Desk', 'tailscale')
      expect(`${copy.title} ${copy.body}`).not.toMatch(/wi-?fi/i)
    }
    expect(connectionCopy('unreachable', 'Desk', 'tailscale').body).toContain(
      'Tailscale',
    )
  })

  test('names Wi-Fi only when that is the route', () => {
    expect(connectionCopy('unreachable', 'Desk', 'wifi').body).toContain(
      'same Wi-Fi',
    )
    expect(connectionCopy('unreachable', 'Desk', null).body).not.toMatch(
      /wi-?fi/i,
    )
    expect(connectionCopy('connecting', 'Desk', null).body).not.toMatch(
      /wi-?fi|local/i,
    )
  })

  test('the reconnecting banner counts queued keystrokes', () => {
    expect(connectionCopy('reconnecting', 'Desk', 'tailscale', 3).body).toBe(
      'Keystrokes are queued (3).',
    )
  })
})

const viewInput = {
  status: 'connected',
  downSince: null,
  route: 'tailscale' as const,
  queued: 0,
  lastConnectedAt: null,
  removal: null,
  record: {
    deviceHint: 'Instance 20260926 0231',
    lastIp: 'desk.tail1234.ts.net',
  },
  now: 0,
}

describe('connectionView', () => {
  test('a cold start takes its route from the host that worked last', () => {
    const view = connectionView({
      ...viewInput,
      status: 'connecting',
      route: null,
    })
    expect(view.state).toBe('connecting')
    expect(view.route).toBe('tailscale')
  })

  test('removed names the desktop that removed the phone', () => {
    const view = connectionView({
      ...viewInput,
      removal: { desk: 'Desk' },
      record: null,
    })
    expect(view.state).toBe('removed')
    expect(view.desk).toBe('Desk')
  })

  test('the chip shows a route only while connected', () => {
    expect(chipRoute(connectionView(viewInput))).toBe('tailscale')
    expect(
      chipRoute(connectionView({ ...viewInput, status: 'connecting' })),
    ).toBeNull()
  })
})

describe('connectionBanner', () => {
  test('nothing while connected or connecting', () => {
    expect(connectionBanner(connectionView(viewInput))).toBeNull()
    expect(
      connectionBanner(connectionView({ ...viewInput, status: 'connecting' })),
    ).toBeNull()
  })

  test('reconnecting: amber, with the queue count, no retry', () => {
    const banner = connectionBanner(
      connectionView({
        ...viewInput,
        status: 'unreachable',
        downSince: 0,
        now: 5_000,
        queued: 3,
      }),
    )
    expect(banner).toEqual({
      tone: 'warn',
      text: 'Reconnecting to Instance 20260926 0231… Keystrokes are queued (3).',
      retry: false,
    })
  })

  test('unreachable: red, names the route, offers Retry now', () => {
    const banner = connectionBanner(
      connectionView({
        ...viewInput,
        status: 'unreachable',
        downSince: 0,
        now: RECONNECTING_MS,
      }),
    )
    expect(banner).toEqual({
      tone: 'bad',
      text: "Can't reach Instance 20260926 0231. This desktop is reached over Tailscale.",
      retry: true,
    })
  })
})

test('the unreachable screen lists the last route and when it worked', () => {
  const at = new Date(2026, 10, 17, 18, 33).getTime()
  const rows = connectionDetails(
    connectionView({
      ...viewInput,
      status: 'unreachable',
      lastConnectedAt: at,
    }),
  )
  expect(rows).toEqual([
    {
      label: 'Last route',
      value: { route: 'tailscale', address: 'desk.tail1234.ts.net' },
    },
    { label: 'Last connected', value: '18:33' },
  ])
  expect(clock(at)).toBe('18:33')
  expect(connectionDetails(connectionView(viewInput))).toEqual([])
})
