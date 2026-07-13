import * as SecureStore from 'expo-secure-store'
import { map } from 'nanostores'
import { isDeviceRecord } from './$device.helpers'
import type { DeviceRecord } from './$device.types'

/**
 * Persisted device credentials from the QR pairing handshake. The
 * type declaration lives in `$device.types.ts` and the runtime shape
 * guard in `$device.helpers.ts` so tests can exercise the pure
 * predicate without transitively loading react-native. Re-exported
 * here so callers keep their existing single import path.
 */
export type { DeviceRecord } from './$device.types'

const STORE_KEY = 'agent-terminal.device.v1'

interface DeviceState {
  loaded: boolean
  record: DeviceRecord | null
}

export const $device = map<DeviceState>({
  loaded: false,
  record: null,
})

/**
 * Read the persisted record into the store. Idempotent; call once at
 * app boot before deciding whether to route to `/pair` or auto-
 * connect. Errors surface as `record: null` (rather than throwing)
 * so the UI treats "no record" and "corrupt record" the same way:
 * user re-pairs.
 */
export async function loadDeviceFromSecureStore(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY)
    if (!raw) {
      $device.set({ loaded: true, record: null })
      return
    }
    const parsed: unknown = JSON.parse(raw)
    if (!isDeviceRecord(parsed)) {
      // Partial-corrupt blob (valid JSON, wrong shape). Treat like
      // "no record" so the user re-pairs; carrying half a record
      // forward would silently break resolveWssCandidates
      // downstream (e.g. `ips[0]` undefined, `port` a string).
      $device.set({ loaded: true, record: null })
      return
    }
    $device.set({ loaded: true, record: parsed })
  } catch {
    $device.set({ loaded: true, record: null })
  }
}

/**
 * Persist a fresh record (called at the end of a successful pair).
 * Writes to secure-store AND updates the in-memory store atomically.
 */
export async function saveDeviceToSecureStore(
  record: DeviceRecord,
): Promise<void> {
  await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(record))
  $device.set({ loaded: true, record })
}

/**
 * Update the cached `lastIp` + `lastPort` after a successful
 * connection. Best-effort persist; a write failure only means the
 * next connect starts one rung further down the resolver ladder.
 */
export async function updateLastEndpoint(
  ip: string,
  port: number,
): Promise<void> {
  const cur = $device.get().record
  if (!cur) return
  const next: DeviceRecord = { ...cur, lastIp: ip, lastPort: port }
  try {
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next))
  } catch {
    // Swallow: the in-memory update below still helps this session.
  }
  $device.set({ loaded: true, record: next })
}

/**
 * Wipe the persisted record and reset the store. Called by the future
 * "Unpair from desktop" Settings row (lands in the follow-up PR).
 */
// fallow-ignore-next-line unused-export
export async function clearDevice(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(STORE_KEY)
  } catch {
    // Swallow: even if delete fails, we clear the in-memory copy so
    // the user can re-pair without a restart.
  }
  $device.set({ loaded: true, record: null })
}
