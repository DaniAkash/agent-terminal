import { $device, loadDeviceFromSecureStore } from '@/modules/stores/$device'
import { $session } from '@/modules/stores/$session'
import { autoConnect } from './client'

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
let unsubscribe: (() => void) | null = null

export async function initWssBootstrap(): Promise<void> {
  if (initialized) return
  initialized = true

  // Subscribe FIRST so the load-from-secure-store below routes
  // through the same code path as a live pair. Nanostores `subscribe`
  // fires immediately with the current value (`{ loaded: false,
  // record: null }`), which is a no-op here — the real work happens
  // when `loaded` flips true.
  unsubscribe = $device.subscribe((state) => {
    if (!state.loaded) return
    if (!state.record) return
    // Don't stack redundant autoConnect calls: skip if the client is
    // already up or negotiating.
    const status = $session.get().status
    if (status === 'connected' || status === 'connecting') return
    void autoConnect(state.record)
  })

  // Cold-start read. Fires the subscriber above as a side effect of
  // `$device.set(...)` inside; if the phone was previously paired,
  // that immediately kicks the resolver ladder.
  await loadDeviceFromSecureStore()
}

/** Test / hot-reload seam: tears down the subscription. */
// fallow-ignore-next-line unused-export
export function resetWssBootstrap(): void {
  unsubscribe?.()
  unsubscribe = null
  initialized = false
}
