import type { ProjectSummary } from '@/modules/wss/protocol.gen'

/**
 * Last-known session tree for a paired desktop, so the Sessions list has
 * something to show for a desktop that is not the one currently driving
 * the socket instead of it just disappearing from the list.
 */
export interface DeviceSessionsEntry {
  projects: ProjectSummary[]
  syncedAt: number
}

export type DeviceSessionsMap = Record<string, DeviceSessionsEntry>

export function isDeviceSessionsMap(v: unknown): v is DeviceSessionsMap {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>).every(isEntry)
}

function isEntry(v: unknown): v is DeviceSessionsEntry {
  if (!v || typeof v !== 'object') return false
  const entry = v as Record<string, unknown>
  return Array.isArray(entry.projects) && typeof entry.syncedAt === 'number'
}

export function cacheDeviceSessions(
  map: DeviceSessionsMap,
  deviceId: string,
  projects: ProjectSummary[],
  syncedAt: number,
): DeviceSessionsMap {
  return { ...map, [deviceId]: { projects, syncedAt } }
}

export function dropDeviceSessions(
  map: DeviceSessionsMap,
  deviceId: string,
): DeviceSessionsMap {
  if (!(deviceId in map)) return map
  const next = { ...map }
  delete next[deviceId]
  return next
}
