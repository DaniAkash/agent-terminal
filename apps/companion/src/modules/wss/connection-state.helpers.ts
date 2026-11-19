import { type Route, routeLabel, routeOfHost } from './route.helpers'

/**
 * The connection vocabulary of the Companion State Map. The desktop uses
 * the same five names, so a state reads the same on both screens.
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'unreachable'
  | 'removed'

/** How long a lost connection counts as Reconnecting before it is Unreachable. */
export const RECONNECTING_MS = 30_000

export interface ConnectionInput {
  /** Raw `$session.status`. */
  status: string
  /** When the last working connection was lost; null if none was. */
  downSince: number | null
  /** The desktop revoked this phone (or no longer knows its token). */
  removed: boolean
  now: number
}

/**
 * Which state to show. A connection that was up and dropped is
 * Reconnecting for its first 30 s, whatever the socket is doing in
 * between retries, and Unreachable after; one that never came up this
 * run is Connecting until the ladder gives up.
 */
export function connectionState(input: ConnectionInput): ConnectionState {
  if (input.removed) return 'removed'
  if (input.status === 'connected') return 'connected'
  if (input.downSince !== null) {
    return input.now - input.downSince < RECONNECTING_MS
      ? 'reconnecting'
      : 'unreachable'
  }
  if (input.status === 'unreachable' || input.status === 'auth_failed') {
    return 'unreachable'
  }
  return 'connecting'
}

/** Tone of each state: blue working, green good, amber attention, red ended. */
export const CONNECTION_TONE = {
  connecting: 'busy',
  connected: 'ok',
  reconnecting: 'warn',
  unreachable: 'bad',
  removed: 'bad',
} as const satisfies Record<ConnectionState, string>

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  unreachable: 'Unreachable',
  removed: 'Removed',
}

export interface ConnectionCopy {
  title: string
  body: string
}

/**
 * What a state says at full size and in the terminal banner. The route
 * names the network to check; nothing says "Wi-Fi" unless the route is
 * Wi-Fi, because a desktop reached over Tailscale shares no Wi-Fi with
 * the phone.
 */
export function connectionCopy(
  state: ConnectionState,
  desk: string,
  route: Route | null,
  queued = 0,
): ConnectionCopy {
  switch (state) {
    case 'connecting':
      return {
        title: `Connecting to ${desk}`,
        body: route
          ? `Trying ${routeLabel(route)}, the route that worked last time.`
          : 'Trying every route this desktop gave.',
      }
    case 'connected':
      return {
        title: `Connected to ${desk}`,
        body: route ? `Over ${routeLabel(route)}.` : '',
      }
    case 'reconnecting':
      return {
        title: `Reconnecting to ${desk}…`,
        body:
          queued > 0
            ? `Keystrokes are queued (${queued}).`
            : 'Keystrokes you type are queued.',
      }
    case 'unreachable':
      return { title: `Can't reach ${desk}`, body: unreachableHint(route) }
    case 'removed':
      return {
        title: 'Removed on the desktop',
        body: `This phone was removed from ${desk}'s paired devices. Its access has ended.`,
      }
  }
}

function unreachableHint(route: Route | null): string {
  if (route === 'tailscale') {
    return 'This desktop is reached over Tailscale. Check that Tailscale is on on this phone; the app keeps retrying.'
  }
  if (route === 'wifi') {
    return 'This desktop is reached over Wi-Fi. Check that this phone is on the same Wi-Fi as the desktop; the app keeps retrying.'
  }
  return 'Check that Agent Terminal is running on the desktop; the app keeps retrying.'
}

/** Everything any size of the status component shows. */
export interface ConnectionView {
  state: ConnectionState
  /** Route of this connection, or of the last one that worked. */
  route: Route | null
  /** The desktop's name. */
  desk: string
  queued: number
  lastConnectedAt: number | null
  /** The address last connected to. */
  lastHost: string | null
}

/** Derive the view from the stores, in one tested place. */
export function connectionView(input: {
  status: string
  downSince: number | null
  route: Route | null
  queued: number
  lastConnectedAt: number | null
  /** Set when the desktop removed this phone (`$removal`). */
  removal: { desk: string } | null
  /** The paired desktop (`$activeDevice.record`). */
  record: { deviceHint: string; lastIp: string | null } | null
  now: number
}): ConnectionView {
  const lastHost = input.record?.lastIp ?? null
  return {
    state: connectionState({
      status: input.status,
      downSince: input.downSince,
      removed: input.removal !== null,
      now: input.now,
    }),
    route: input.route ?? (lastHost ? routeOfHost(lastHost) : null),
    desk: input.removal?.desk ?? input.record?.deviceHint ?? 'the desktop',
    queued: input.queued,
    lastConnectedAt: input.lastConnectedAt,
    lastHost,
  }
}

/** The route the header chip shows: only while connected. */
export function chipRoute(view: ConnectionView): Route | null {
  return view.state === 'connected' ? view.route : null
}

/**
 * The terminal banner: shown only while the link is down. The
 * unreachable hint is cut to the route, since the terminal needs its
 * rows; the full sentence is for the full screen.
 */
export function connectionBanner(
  view: ConnectionView,
): { tone: 'warn' | 'bad'; text: string; retry: boolean } | null {
  const { state, desk, route, queued } = view
  if (state === 'reconnecting') {
    const copy = connectionCopy(state, desk, route, queued)
    return { tone: 'warn', text: `${copy.title} ${copy.body}`, retry: false }
  }
  if (state === 'unreachable') {
    const via = route
      ? ` This desktop is reached over ${routeLabel(route)}.`
      : ''
    return { tone: 'bad', text: `Can't reach ${desk}.${via}`, retry: true }
  }
  return null
}

/** Details under the full screen: where the phone last reached the desktop. */
export function connectionDetails(
  view: ConnectionView,
): (
  | { label: string; value: string }
  | { label: string; value: { route: Route; address?: string } }
)[] {
  if (view.state !== 'unreachable') return []
  const rows: ReturnType<typeof connectionDetails> = []
  if (view.route) {
    rows.push({
      label: 'Last route',
      value: view.lastHost
        ? { route: view.route, address: view.lastHost }
        : { route: view.route },
    })
  }
  if (view.lastConnectedAt !== null) {
    rows.push({ label: 'Last connected', value: clock(view.lastConnectedAt) })
  }
  return rows
}

/** "18:33", local time. */
export function clock(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
