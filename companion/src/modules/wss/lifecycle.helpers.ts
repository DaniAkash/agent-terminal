/**
 * Pure decision helpers for the AppState + NetInfo listeners in
 * lifecycle.ts. Extracting the branchy logic here keeps the async
 * shells thin (one switch each) and lets us unit-test the decisions
 * without mocking AppState / NetInfo.
 */

import type { AppStateStatus } from 'react-native'

/**
 * Backgrounds shorter than this are trusted: the socket often survives
 * a quick app switch. Longer backgrounds burn the socket preemptively
 * because iOS starts suspending sockets in the first minute or so.
 */
export const TRUSTED_BACKGROUND_MS = 60_000

export type AppStateTransition = 'foreground' | 'background' | 'none'

/** Classify an AppState transition into one of the three we care about. */
export function classifyAppStateTransition(
  prev: AppStateStatus,
  next: AppStateStatus,
): AppStateTransition {
  const isBackgroundish = (s: AppStateStatus): boolean =>
    s === 'background' || s === 'inactive'
  if (prev === 'active' && isBackgroundish(next)) return 'background'
  if (isBackgroundish(prev) && next === 'active') return 'foreground'
  return 'none'
}

export type SessionStatusHint =
  | 'connected'
  | 'connecting'
  | 'unreachable'
  | 'auth_failed'
  | 'disconnected'

export type ForegroundAction = 'skip' | 'probe' | 'reconnect'

/**
 * Decide what to do when the app comes back to the foreground.
 *
 * - No paired device -> nothing to do, skip.
 * - Already reconnecting -> let the ladder finish, skip.
 * - Long background OR was already offline -> reconnect.
 * - Otherwise (short background AND we think we're connected) -> probe.
 */
export function decideForegroundAction(
  elapsedMs: number,
  status: SessionStatusHint,
  hasRecord: boolean,
): ForegroundAction {
  if (!hasRecord) return 'skip'
  if (status === 'connecting') return 'skip'
  if (elapsedMs > TRUSTED_BACKGROUND_MS) return 'reconnect'
  if (status !== 'connected') return 'reconnect'
  return 'probe'
}

/** Minimal shape of a NetInfoState we care about for lifecycle decisions. */
export interface NetInfoLike {
  isInternetReachable: boolean | null
}

export type NetInfoAction = 'skip' | 'force-close' | 'reconnect'

/**
 * Decide what to do on a NetInfo change.
 *
 * - isInternetReachable=false while we think we're connected -> close;
 *   the socket is guaranteed dead once the network says so and closing
 *   now lets the reconnect ladder be ready the instant we're back.
 * - isInternetReachable=true while we're unreachable AND paired ->
 *   reconnect. This is the "network came back" case.
 * - null (unknown, common during Android boot) -> skip.
 */
export function classifyNetInfoChange(
  net: NetInfoLike,
  status: SessionStatusHint,
  hasRecord: boolean,
): NetInfoAction {
  if (net.isInternetReachable === false && status === 'connected') {
    return 'force-close'
  }
  if (
    net.isInternetReachable === true &&
    status === 'unreachable' &&
    hasRecord
  ) {
    return 'reconnect'
  }
  return 'skip'
}
