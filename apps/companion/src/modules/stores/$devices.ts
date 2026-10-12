import * as SecureStore from 'expo-secure-store'
import { computed, map } from 'nanostores'
import {
  deviceStorageSlug,
  isDeviceRecord,
  isDevicesIndex,
  nextActiveId,
  reconcileIndex,
} from './$devices.helpers'
import type { DeviceRecord, DevicesIndex, DevicesState } from './$devices.types'

/**
 * Paired desktops, keyed by device id, plus which one is currently
 * driven. The type declarations live in `$devices.types.ts` and the
 * pure predicates in `$devices.helpers.ts` so tests can exercise them
 * without loading react-native.
 */
export type { DeviceRecord } from './$devices.types'

const INDEX_KEY = 'agent-terminal.devices.index.v2'
const RECORD_PREFIX = 'agent-terminal.device.v2.'

function recordKey(deviceId: string): string {
  return `${RECORD_PREFIX}${deviceStorageSlug(deviceId)}`
}

// Consumed today only through `$activeDevice` below; the desktop picker
// that reads the whole map lands with the switcher UI.
// fallow-ignore-next-line unused-export
export const $devices = map<DevicesState>({
  loaded: false,
  byId: {},
  activeId: null,
})

/**
 * The desktop currently being driven, in the shape the WSS layer wants.
 * Everything that only cares about "which desktop am I talking to"
 * reads this rather than the map, so adding more desktops stayed a
 * one-file change for those call sites.
 */
export const $activeDevice = computed($devices, (state) => ({
  loaded: state.loaded,
  record: state.activeId ? (state.byId[state.activeId] ?? null) : null,
}))

async function persistIndex(
  ids: string[],
  activeId: string | null,
): Promise<void> {
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify({ ids, activeId }))
}

/**
 * Read every persisted record into the store. Idempotent; call once at
 * boot before deciding whether to route to pairing or auto-connect.
 * A record that is missing or fails the shape guard is dropped from the
 * index rather than carried forward half-formed, matching the previous
 * single-record behaviour where a corrupt blob meant "re-pair".
 */
async function readIndex(): Promise<DevicesIndex | null> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY)
  if (!raw) return null
  const parsed: unknown = JSON.parse(raw)
  return isDevicesIndex(parsed) ? parsed : null
}

/**
 * Read each record named by the index. One unreadable or malformed entry
 * is skipped rather than failing the whole load; `reconcileIndex` then
 * drops its dangling id.
 */
async function readRecords(
  ids: string[],
): Promise<Record<string, DeviceRecord>> {
  const byId: Record<string, DeviceRecord> = {}
  for (const id of ids) {
    try {
      const raw = await SecureStore.getItemAsync(recordKey(id))
      if (!raw) continue
      const parsed: unknown = JSON.parse(raw)
      if (isDeviceRecord(parsed)) byId[id] = parsed
    } catch {
      // Skipped; reconcileIndex removes the id below.
    }
  }
  return byId
}

/**
 * Read every persisted record into the store. Idempotent; call once at
 * boot before deciding whether to route to pairing or auto-connect.
 * A missing index, a corrupt index, or a thrown read all land on the
 * same empty state, matching the previous single-record behaviour where
 * anything unreadable meant "re-pair".
 */
export async function loadDevicesFromSecureStore(): Promise<void> {
  try {
    const index = await readIndex()
    if (!index) {
      $devices.set({ loaded: true, byId: {}, activeId: null })
      return
    }
    const byId = await readRecords(index.ids)
    const { ids, activeId } = reconcileIndex(index.ids, byId, index.activeId)
    if (ids.length !== index.ids.length || activeId !== index.activeId) {
      await persistIndex(ids, activeId).catch(() => {})
    }
    $devices.set({ loaded: true, byId, activeId })
  } catch {
    $devices.set({ loaded: true, byId: {}, activeId: null })
  }
}

/**
 * Persist a freshly paired desktop and make it active. Re-pairing an
 * existing desktop replaces its record in place rather than adding a
 * duplicate entry.
 */
export async function saveDeviceToSecureStore(
  record: DeviceRecord,
): Promise<void> {
  const state = $devices.get()
  const ids = state.byId[record.deviceId]
    ? Object.keys(state.byId)
    : [...Object.keys(state.byId), record.deviceId]

  await SecureStore.setItemAsync(
    recordKey(record.deviceId),
    JSON.stringify(record),
  )
  await persistIndex(ids, record.deviceId)

  $devices.set({
    loaded: true,
    byId: { ...state.byId, [record.deviceId]: record },
    activeId: record.deviceId,
  })
}

/**
 * Update the cached `lastIp` + `lastPort` on the active desktop after a
 * successful connection. Best-effort persist; a write failure only means
 * the next connect starts one rung further down the resolver ladder.
 */
export async function updateLastEndpoint(
  ip: string,
  port: number,
): Promise<void> {
  const state = $devices.get()
  const id = state.activeId
  const cur = id ? state.byId[id] : null
  if (!id || !cur) return
  const next: DeviceRecord = { ...cur, lastIp: ip, lastPort: port }
  try {
    await SecureStore.setItemAsync(recordKey(id), JSON.stringify(next))
  } catch {
    // Swallow: the in-memory update below still helps this session.
  }
  $devices.set({ ...state, byId: { ...state.byId, [id]: next } })
}

/**
 * Switch which desktop is driven. A no-op for an unknown id so a stale
 * deep link cannot strand the app pointing at nothing.
 *
 * Moving the socket is not this function's job: the `$activeDevice`
 * subscriber in `wss/bootstrap.ts` sees the change and swaps the connection,
 * which keeps the store free of any dependency on the client.
 */
// fallow-ignore-next-line unused-export
export async function setActiveDevice(deviceId: string): Promise<void> {
  const state = $devices.get()
  if (!state.byId[deviceId] || state.activeId === deviceId) return
  await persistIndex(Object.keys(state.byId), deviceId).catch(() => {})
  $devices.set({ ...state, activeId: deviceId })
}

/**
 * Forget the active desktop. Falls back to another paired one when there
 * is one, so unpairing does not drop the user onto the unpaired CTA
 * while other desktops remain.
 */
export async function clearDevice(): Promise<void> {
  const state = $devices.get()
  const id = state.activeId
  if (!id) return
  const ids = Object.keys(state.byId)
  const activeId = nextActiveId(ids, id, state.activeId)
  const byId = { ...state.byId }
  delete byId[id]

  try {
    await SecureStore.deleteItemAsync(recordKey(id))
    await persistIndex(Object.keys(byId), activeId)
  } catch {
    // Swallow: even if the writes fail we clear the in-memory copy so
    // the user can re-pair without a restart.
  }
  $devices.set({ loaded: true, byId, activeId })
}
