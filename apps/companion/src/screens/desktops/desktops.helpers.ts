import type { DeviceRecord } from '@/modules/stores/$devices.types'

export interface DesktopRow {
  deviceId: string
  name: string
  endpoint: string
  isActive: boolean
}

/**
 * The paired desktops, active one first.
 *
 * Sorted rather than left in pairing order so the one you are driving is
 * always the row your eye lands on, and the rest keep a stable order
 * underneath it.
 */
export function desktopRows(
  byId: Record<string, DeviceRecord>,
  activeId: string | null,
): DesktopRow[] {
  const rows = Object.values(byId).map((record) => ({
    deviceId: record.deviceId,
    name: record.deviceHint || record.host || record.deviceId,
    endpoint: endpointOf(record),
    isActive: record.deviceId === activeId,
  }))
  rows.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return rows
}

/**
 * Where this desktop was last reached. Shows the resolved endpoint when
 * there is one, because that is the address that actually worked, and
 * falls back to the advertised host otherwise.
 */
export function endpointOf(record: DeviceRecord): string {
  if (record.lastIp) return `${record.lastIp}:${record.lastPort ?? record.port}`
  if (record.host) return `${record.host}:${record.port}`
  const [first] = record.ips
  return first ? `${first}:${record.port}` : ''
}
