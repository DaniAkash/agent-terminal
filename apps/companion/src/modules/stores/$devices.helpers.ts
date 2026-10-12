import type { DeviceRecord, DevicesIndex } from './$devices.types'

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

/** Runtime shape guard for the persisted device index. */
export function isDevicesIndex(v: unknown): v is DevicesIndex {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  if (!Array.isArray(r.ids)) return false
  if (!r.ids.every((id) => typeof id === 'string' && id.length > 0))
    return false
  if (r.activeId !== null && typeof r.activeId !== 'string') return false
  return true
}

/**
 * Choose the active device after one is removed. Prefers the first
 * remaining entry so unpairing the current desktop drops the user onto
 * another paired one rather than onto the unpaired CTA.
 */
export function nextActiveId(
  ids: string[],
  removedId: string,
  currentActiveId: string | null,
): string | null {
  if (currentActiveId !== removedId) return currentActiveId
  const remaining = ids.filter((id) => id !== removedId)
  return remaining[0] ?? null
}

/**
 * Reconcile an index against the records that actually loaded. A record
 * whose secure-store key is missing or corrupt must not leave a dangling
 * id in the index, and the active pointer must always name a real entry.
 */
export function reconcileIndex(
  ids: string[],
  byId: Record<string, DeviceRecord>,
  activeId: string | null,
): { ids: string[]; activeId: string | null } {
  const present = ids.filter((id) => byId[id] !== undefined)
  const active =
    activeId && present.includes(activeId) ? activeId : (present[0] ?? null)
  return { ids: present, activeId: active }
}

/**
 * Encode a device id for use inside a SecureStore key.
 *
 * SecureStore rejects any key outside `[A-Za-z0-9._-]`, and device ids
 * are not constrained to that set: manual pairing builds them as
 * `manual:<host>:<port>`, whose colons throw on write. Hex keeps the
 * mapping injective, so two ids can never land on one record, and emits
 * only `[0-9a-f]`.
 */
export function deviceStorageSlug(deviceId: string): string {
  let out = ''
  for (const ch of new TextEncoder().encode(deviceId)) {
    out += ch.toString(16).padStart(2, '0')
  }
  return out
}
