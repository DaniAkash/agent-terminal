import NetInfo from '@react-native-community/netinfo'
import type { NetInfoState } from '@react-native-community/netinfo'
import { AppState } from 'react-native'
import type { AppStateStatus } from 'react-native'
import type { DeviceRecord } from '@/modules/stores/$device'
import { $device } from '@/modules/stores/$device'
import { $session } from '@/modules/stores/$session'
import { autoConnect, forceCloseFromLifecycle, probeConnection } from './client'
import {
  classifyAppStateTransition,
  classifyNetInfoChange,
  decideForegroundAction,
  executeForegroundAction,
  executeNetInfoAction,
  type LifecycleDeps,
  type SessionStatusHint,
} from './lifecycle.helpers'

/**
 * Real production side-effect wiring. Static per module load: the
 * executors are stateless, so a single frozen deps object is safe to
 * share across every handler invocation.
 */
const deps: LifecycleDeps<DeviceRecord> = {
  autoConnect,
  probeConnection,
  forceClose: forceCloseFromLifecycle,
}

let initialized = false
let currentAppState: AppStateStatus = AppState.currentState
let backgroundedAt: number | null = null
let appStateSub: { remove: () => void } | null = null
let netInfoUnsub: (() => void) | null = null

/**
 * Attach AppState + NetInfo listeners that keep the WSS client honest
 * about the mobile lifecycle:
 *
 * - Foreground after a short background: probe the socket. Reconnect
 *   only if the probe fails.
 * - Foreground after a long background: reconnect unconditionally.
 * - Network drop: force-close so the reconnect ladder can start the
 *   instant the network comes back.
 * - Network back: kick autoConnect if we were unreachable.
 *
 * Every decision routes through the pure helpers in
 * `lifecycle.helpers.ts`; this file is the thin shell that wires the
 * side effects (autoConnect / probeConnection / forceCloseFromLifecycle)
 * to the classified events.
 *
 * Idempotent: safe to call multiple times, only wires once.
 */
export function initLifecycleWiring(): void {
  if (initialized) return
  initialized = true
  currentAppState = AppState.currentState
  appStateSub = AppState.addEventListener('change', handleAppStateChange)
  netInfoUnsub = NetInfo.addEventListener(handleNetInfoChange)
}

/** Test / hot-reload seam: detaches both listeners. */
export function resetLifecycleWiring(): void {
  appStateSub?.remove()
  netInfoUnsub?.()
  appStateSub = null
  netInfoUnsub = null
  backgroundedAt = null
  initialized = false
}

function handleAppStateChange(next: AppStateStatus): void {
  const transition = classifyAppStateTransition(currentAppState, next)
  currentAppState = next
  if (transition === 'background') {
    backgroundedAt = Date.now()
    console.log('[wss.lifecycle] backgrounded')
    return
  }
  if (transition === 'foreground') {
    const elapsed = backgroundedAt ? Date.now() - backgroundedAt : 0
    backgroundedAt = null
    console.log(`[wss.lifecycle] foregrounded after ${elapsed} ms`)
    handleForegroundResume(elapsed).catch((err) => {
      console.error('[wss.lifecycle] foreground resume failed:', err)
    })
  }
}

async function handleForegroundResume(elapsedMs: number): Promise<void> {
  const record = $device.get().record
  const status = $session.get().status as SessionStatusHint
  const action = decideForegroundAction(elapsedMs, status, record !== null)
  console.log('[wss.lifecycle] resume action:', action, { elapsedMs, status })
  await executeForegroundAction(action, record, deps)
}

function handleNetInfoChange(net: NetInfoState): void {
  const record = $device.get().record
  const status = $session.get().status as SessionStatusHint
  const action = classifyNetInfoChange(net, status, record !== null)
  if (action !== 'skip') console.log('[wss.lifecycle] net action:', action)
  executeNetInfoAction(action, record, deps)
}
