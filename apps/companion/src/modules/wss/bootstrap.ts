import {
  $device,
  clearDevice,
  loadDeviceFromSecureStore,
} from '@/modules/stores/$device'
import { $session } from '@/modules/stores/$session'
import { autoConnect, disconnect } from './client'
import { initLifecycleWiring, resetLifecycleWiring } from './lifecycle'

/**
 * WSS boot-time wiring. Idempotent; safe to call multiple times but
 * only wires once. The layout mounts this at app start; every future
 * `$device` transition (fresh pair, load-from-secure-store, revoke)
 * routes through the same reactive subscription below, so the paired
 * state is a single atom-of-truth and the UI transitions seamlessly
 * without any restart-to-see-effect gymnastics.
 *
 * Flow:
 *
 *   PairScreen → completePairing → saveDeviceToSecureStore
 *     ↓ ($device.set)
 *   this subscriber
 *     ↓ (autoConnect)
 *   client.ts openSocket → auth → $session.status = 'connected'
 *     ↓
 *   HomeScreen re-renders into the paired-home branch
 *
 * Same subscription handles the cold-start path (secure-store already
 * has a record from a previous session) via the initial
 * `loadDeviceFromSecureStore` call below.
 */

let initialized = false
let unsubscribeDevice: (() => void) | null = null
let unsubscribeSession: (() => void) | null = null

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
  unsubscribeDevice = $device.subscribe((state) => {
    if (!state.loaded) return
    if (!state.record) return
    // Don't stack redundant autoConnect calls: skip if the client is
    // already up or negotiating.
    const status = $session.get().status
    if (status === 'connected' || status === 'connecting') return
    void autoConnect(state.record)
  })

  // Server-side revoke recovery. When the desktop closes our
  // connection with AuthFail("revoked") or refuses reconnect with
  // AuthFail("bad token"), the token in secure-store is dead. Clear
  // the local $device record so the UI falls back to the unpaired
  // CTA instead of retry-looping through the ladder with the same
  // dead token. `disconnect()` first stops any timers + resets
  // $session to a clean 'disconnected' state, then `clearDevice()`
  // wipes the record (secure-store + in-memory) which also prevents
  // the $device subscriber above from re-firing autoConnect.
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

  // Cold-start read. Fires the device subscriber above as a side
  // effect of `$device.set(...)` inside; if the phone was previously
  // paired, that immediately kicks the resolver ladder.
  await loadDeviceFromSecureStore()
}

/** Test / hot-reload seam: tears down every subscription + listener. */
// fallow-ignore-next-line unused-export
export function resetWssBootstrap(): void {
  unsubscribeDevice?.()
  unsubscribeSession?.()
  unsubscribeDevice = null
  unsubscribeSession = null
  resetLifecycleWiring()
  initialized = false
}
