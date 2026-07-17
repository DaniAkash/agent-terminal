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
 * Side-effect deps executeForegroundAction and executeNetInfoAction
 * dispatch to. Real production wiring passes the real client.ts
 * exports; tests pass fakes that record what got called.
 */
export interface LifecycleDeps<TRecord> {
  autoConnect: (record: TRecord) => Promise<void>
  probeConnection: () => Promise<'alive' | 'dead'>
  forceClose: (reason: string) => void
}

/**
 * Execute the foreground action chosen by decideForegroundAction. Pure
 * with respect to deps: does not touch $device / $session / imports
 * itself; everything flows in through the deps arg. Kept here (rather
 * than as another switch in lifecycle.ts) so the branching is unit-
 * testable without mocking react-native.
 */
export async function executeForegroundAction<TRecord>(
  action: ForegroundAction,
  record: TRecord | null,
  deps: LifecycleDeps<TRecord>,
): Promise<void> {
  if (action === 'skip' || record === null) return
  if (action === 'reconnect') {
    await deps.autoConnect(record)
    return
  }
  // action === 'probe'
  const verdict = await deps.probeConnection()
  if (verdict === 'dead') await deps.autoConnect(record)
}

/** Same shape as executeForegroundAction, for the NetInfo path. */
export function executeNetInfoAction<TRecord>(
  action: NetInfoAction,
  record: TRecord | null,
  deps: LifecycleDeps<TRecord>,
): void {
  if (action === 'force-close') {
    deps.forceClose('network unreachable')
    return
  }
  if (action === 'reconnect' && record !== null) {
    deps.autoConnect(record).catch((err: unknown) => {
      console.error('[wss.lifecycle] autoConnect from NetInfo failed:', err)
    })
  }
}

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
