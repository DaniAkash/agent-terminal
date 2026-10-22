/**
 * Which session was last worked in, per desktop. Keyed by device id so
 * switching machines lands you where you left off on that machine rather
 * than at an arbitrary session.
 */
export type LastSessionMap = Record<string, string>

export function isLastSessionMap(v: unknown): v is LastSessionMap {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>).every(
    (value) => typeof value === 'string' && value.length > 0,
  )
}

export function rememberSession(
  map: LastSessionMap,
  deviceId: string,
  tabId: string,
): LastSessionMap {
  if (map[deviceId] === tabId) return map
  return { ...map, [deviceId]: tabId }
}

export function forgetDevice(
  map: LastSessionMap,
  deviceId: string,
): LastSessionMap {
  if (!(deviceId in map)) return map
  const next = { ...map }
  delete next[deviceId]
  return next
}
