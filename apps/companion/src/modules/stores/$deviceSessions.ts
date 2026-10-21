import AsyncStorage from '@react-native-async-storage/async-storage'
import { map } from 'nanostores'
import {
  cacheDeviceSessions,
  type DeviceSessionsMap,
  dropDeviceSessions,
  isDeviceSessionsMap,
} from './$deviceSessions.helpers'
import { $activeDevice } from './$devices'
import { $session } from './$session'

/**
 * Last-known session tree per paired desktop, keyed by device id. Not
 * secret — it is the same project/tab names the Sessions list already
 * renders — so this lives in AsyncStorage rather than beside the device
 * records in SecureStore, which iOS has historically capped at roughly
 * 2KB per value (see `$devices.types.ts`): a session tree would blow
 * that ceiling on anything past a brand-new pair.
 *
 * Exists so switching the driven desktop stops erasing the other paired
 * desktop's Sessions list. See `switcherGroups` in
 * `screens/switcher/switcher.helpers.ts` for how this is read.
 */
export const $deviceSessions = map<DeviceSessionsMap>({})

const STORAGE_KEY = 'agent-terminal.deviceSessions.v1'

let unsubscribe: (() => void) | null = null

export async function loadDeviceSessionsFromStorage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (isDeviceSessionsMap(parsed)) $deviceSessions.set(parsed)
  } catch {
    // Starts empty; every paired desktop still shows once it syncs again.
  }
}

function persist(next: DeviceSessionsMap): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
}

/**
 * Cache the active desktop's session tree the moment it is told, so the
 * next time another desktop is driving the socket this one still has
 * something to show. Wired once at boot; a no-op until a desktop pairs.
 */
export function initDeviceSessionsCache(): void {
  if (unsubscribe) return
  unsubscribe = $session.subscribe((session) => {
    if (!session.projectsLoaded) return
    const deviceId = $activeDevice.get().record?.deviceId
    if (!deviceId) return
    const cache = $deviceSessions.get()
    // $session fires on every status change (reconnects, errors), not
    // just on a fresh Projects frame — `projects` keeps its old array
    // reference across those, since nanostores' `map()` only replaces
    // the key it was told to. Skipping when the reference is unchanged
    // avoids a redundant AsyncStorage write + store update per flap.
    if (cache[deviceId]?.projects === session.projects) return
    const next = cacheDeviceSessions(
      cache,
      deviceId,
      session.projects,
      Date.now(),
    )
    $deviceSessions.set(next)
    persist(next)
  })
}

/** Drop a desktop's cached sessions, e.g. when it is unpaired. */
export function forgetDeviceSessions(deviceId: string): void {
  const next = dropDeviceSessions($deviceSessions.get(), deviceId)
  if (next === $deviceSessions.get()) return
  $deviceSessions.set(next)
  persist(next)
}

/** Test / hot-reload seam, mirrors `resetWssBootstrap`. */
export function resetDeviceSessionsCache(): void {
  unsubscribe?.()
  unsubscribe = null
}
