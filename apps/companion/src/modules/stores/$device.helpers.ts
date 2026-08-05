import type { DeviceRecord } from './$device.types'

/**
 * Runtime shape guard for the persisted DeviceRecord. Cheap; called
 * once per app boot from `loadDeviceFromSecureStore`. Validates every
 * field the resolver + client touches so a downstream `device.ips[0]`
 * or `device.port` cannot blow up on a stale blob from a prior schema.
 *
 * Lives in a satellite file (no react-native / expo-secure-store
 * imports) so bun test can exercise the pure predicate without
 * loading Metro-only modules.
 */
// fallow-ignore-next-line complexity
export function isDeviceRecord(v: unknown): v is DeviceRecord {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  if (typeof r.token !== 'string' || r.token.length === 0) return false
  if (typeof r.deviceId !== 'string' || r.deviceId.length === 0) return false
  if (typeof r.port !== 'number' || !Number.isFinite(r.port)) return false
  if (typeof r.fingerprint !== 'string') return false
  if (typeof r.deviceHint !== 'string') return false
  if (r.host !== undefined && typeof r.host !== 'string') return false
  if (!Array.isArray(r.ips)) return false
  if (!r.ips.every((ip) => typeof ip === 'string')) return false
  if (r.lastIp !== null && typeof r.lastIp !== 'string') return false
  if (r.lastPort !== null && typeof r.lastPort !== 'number') return false
  return true
}
