import {
  initDeviceSessionsCache,
  loadDeviceSessionsFromStorage,
  resetDeviceSessionsCache,
} from '@/modules/stores/$deviceSessions'
import {
  $activeDevice,
  clearDevice,
  loadDevicesFromSecureStore,
} from '@/modules/stores/$devices'
import { migrateDevicesV1ToV2 } from '@/modules/stores/$devices.migrate'
import { loadLastSessions } from '@/modules/stores/$lastSession'
import { $session } from '@/modules/stores/$session'
import { decideDeviceAction } from './bootstrap.helpers'
import { autoConnect, disconnect } from './client'
import { initLifecycleWiring, resetLifecycleWiring } from './lifecycle'
import type { SessionStatusHint } from './lifecycle.helpers'

/**
 * WSS boot-time wiring. Idempotent; safe to call multiple times but
 * only wires once. The layout mounts this at app start; every future
 * `$activeDevice` transition (fresh pair, load-from-secure-store, revoke)
 * routes through the same reactive subscription below, so the paired
 * state is a single atom-of-truth and the UI transitions seamlessly
 * without any restart-to-see-effect gymnastics.
 *
 * Flow:
 *
 *   PairScreen → completePairing → saveDeviceToSecureStore
 *     ↓ ($activeDevice.set)
 *   this subscriber
 *     ↓ (autoConnect)
 *   client.ts openSocket → auth → $session.status = 'connected'
 *     ↓
 *   HomeScreen re-renders into the paired-home branch
 *
 * Same subscription handles the cold-start path (secure-store already
 * has a record from a previous session) via the initial
 * `loadDevicesFromSecureStore` call below.
 */

let initialized = false
let unsubscribeDevice: (() => void) | null = null
let unsubscribeSession: (() => void) | null = null
/** The desktop the current socket belongs to, so a switch can be spotted. */
let drivenDeviceId: string | null = null

/**
 * Reasons the desktop returns in `ServerFrame::AuthFail` that mean
 * "your device_token is no longer valid" — either the desktop
 * revoked us (Companion dialog → Revoke) or the token itself is
 * gone (Keychain wiped, dev config reset). Substring match keeps us
 * resilient to small wording drift on the desktop side.
 */
const REVOKED_REASONS = ['revoked', 'bad token'] as const

function isRevokedAuthFail(reason: string | null): boolean {
  if (!reason) return false
  const lower = reason.toLowerCase()
  return REVOKED_REASONS.some((r) => lower.includes(r))
}

export async function initWssBootstrap(): Promise<void> {
  if (initialized) return
  initialized = true

  // Subscribe FIRST so the load-from-secure-store below routes
  // through the same code path as a live pair. Nanostores `subscribe`
  // fires immediately with the current value (`{ loaded: false,
  // record: null }`), which is a no-op here — the real work happens
  // when `loaded` flips true.
  unsubscribeDevice = $activeDevice.subscribe((state) => {
    if (!state.loaded) return
    const record = state.record
    const action = decideDeviceAction(
      drivenDeviceId,
      record?.deviceId ?? null,
      $session.get().status as SessionStatusHint,
    )
    if (action === 'skip') {
      // Revoked or unpaired: there is no desktop to be driving any more.
      if (!record) drivenDeviceId = null
      return
    }
    if (!record) return
    // A switch tears the old socket down first; see decideDeviceAction.
    if (action === 'switch') disconnect()
    drivenDeviceId = record.deviceId
    void autoConnect(record)
  })

  // Server-side revoke recovery. When the desktop closes our
  // connection with AuthFail("revoked") or refuses reconnect with
  // AuthFail("bad token"), the token in secure-store is dead. Clear
  // the local $activeDevice record so the UI falls back to the unpaired
  // CTA instead of retry-looping through the ladder with the same
  // dead token. `disconnect()` first stops any timers + resets
  // $session to a clean 'disconnected' state, then `clearDevice()`
  // wipes the record (secure-store + in-memory) which also prevents
  // the $activeDevice subscriber above from re-firing autoConnect.
  unsubscribeSession = $session.subscribe((state) => {
    if (state.status !== 'auth_failed') return
    if (!isRevokedAuthFail(state.lastError)) return
    console.log(
      `[wss] auth_failed "${state.lastError}"; unpairing locally (desktop revoked / token invalid)`,
    )
    disconnect()
    void clearDevice()
  })

  // AppState + NetInfo wiring. Attaches listeners that force-close the
  // socket on network drops and probe / reconnect on app foreground so
  // a backgrounded-app-with-dead-socket case never bricks the client.
  initLifecycleWiring()

  // One-shot move of a pre-existing single record into the sharded
  // multi-desktop layout. Must run before the load below, which only
  // knows about v2 keys.
  await migrateDevicesV1ToV2()

  // Landing shortcut for the resolver. Independent of the connection, so
  // a failure here only costs the shortcut.
  await loadLastSessions()

  // Subscribes to $session so every desktop's tree gets cached the
  // moment it is told, so a desktop that is not currently driving the
  // socket still has something cached to show in the Sessions list.
  initDeviceSessionsCache()
  await loadDeviceSessionsFromStorage()

  // Cold-start read. Fires the device subscriber above as a side
  // effect of the `$devices.set(...)` inside; if the phone was
  // previously paired, that immediately kicks the resolver ladder.
  await loadDevicesFromSecureStore()
}

/** Test / hot-reload seam: tears down every subscription + listener. */
// fallow-ignore-next-line unused-export
export function resetWssBootstrap(): void {
  unsubscribeDevice?.()
  unsubscribeSession?.()
  unsubscribeDevice = null
  unsubscribeSession = null
  drivenDeviceId = null
  resetLifecycleWiring()
  resetDeviceSessionsCache()
  initialized = false
}
