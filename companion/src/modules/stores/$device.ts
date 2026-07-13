import * as SecureStore from 'expo-secure-store'
import { map } from 'nanostores'

/**
 * Persisted device credentials from the QR pairing handshake. The
 * token is the long-lived per-device token minted by the desktop;
 * everything else supports the self-healing resolver ladder in
 * `wss/resolver.ts`.
 *
 * Serialised as a single JSON blob under one secure-store key so the
 * six-field write is atomic (`SecureStore.setItemAsync`).
 */
export interface DeviceRecord {
  /** Long-lived token; `wss://.../stream` Auth frame token field. */
  token: string
  /** Stable server-side id, used for future revocation UX. */
  deviceId: string
  /** `.local` hostname; falls back if absent. */
  host?: string
  /** LAN IPv4s the desktop advertised at pairing time. */
  ips: string[]
  /** Currently-bound WSS port; resolver ladder iterates the trio on
   *  failure. */
  port: number
  /** SHA-256 fingerprint the desktop displayed for the visual match. */
  fingerprint: string
  /** Human hint from the QR, so the UI can display "connected to
   *  Dani's MacBook Pro" instead of an IP. */
  deviceHint: string
  /** Last IP that successfully resolved a connection. Prefilled from
   *  `ips[0]` at pair time; updated by the resolver on every
   *  successful handshake. */
  lastIp: string | null
  /** Last port that successfully resolved. Same pattern as `lastIp`. */
  lastPort: number | null
}

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
    const record: DeviceRecord = JSON.parse(raw)
    $device.set({ loaded: true, record })
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
