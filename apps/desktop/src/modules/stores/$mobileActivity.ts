import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { atom } from 'nanostores'
import { toast } from 'sonner'
import { routeOfAddress } from '@/components/Companion/companion.helpers'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import {
  makeTabKey,
  resolveTabLabel,
} from '@/screens/workspace/workspace.helpers'

/**
 * `online`: the phone has the tab open. `idle`: it is still connected but
 * has been off every terminal for a minute. Decided by the Rust WSS server
 * (`MobileTabSubscriptions`); this store only shows it.
 */
export type MobilePresenceStatus = 'online' | 'idle'

export interface MobileSubscriberInfo {
  connection_id: number
  device_id?: string
  device_name: string
  platform: string
  model?: string
  peer_ip?: string
  status: MobilePresenceStatus
  last_active_at: number
}

export type ActiveMobileTabsMap = Record<string, MobileSubscriberInfo[]>

/**
 * Active mobile companion subscribers keyed by tab key (`${projectId}:${tabId}`).
 */
export const $activeMobileTabs = atom<ActiveMobileTabsMap>({})

let listenerInstalled = false
/** A phone as presence sees it: its record and the tab it is on. */
interface DevicePresence {
  dev: MobileSubscriberInfo
  tabKey: string
}

let prevDeviceStates = new Map<string, DevicePresence>()

function deviceKey(dev: MobileSubscriberInfo): string {
  return dev.device_id ?? `${dev.device_name}:${dev.connection_id}`
}

function dedupeDevices(
  devices: MobileSubscriberInfo[],
): MobileSubscriberInfo[] {
  const byKey = new Map<string, MobileSubscriberInfo>()
  for (const dev of devices) {
    const key = deviceKey(dev)
    const existing = byKey.get(key)
    if (!existing || (existing.status === 'idle' && dev.status === 'online')) {
      byKey.set(key, dev)
    }
  }
  return Array.from(byKey.values())
}

function presenceToast(
  key: string,
  title: string,
  description: string,
  show: typeof toast | typeof toast.success = toast,
): void {
  show(title, { id: `mobile-presence-${key}`, description, duration: 3000 })
}

/**
 * Display name of the tab behind a `${projectId}:${tabId}` key, the same
 * one its sidebar row shows. Null when the tab is gone.
 */
function tabLabelForKey(tabKey: string): string | null {
  for (const project of $projects.get()) {
    for (const tab of project.tabs) {
      const key = makeTabKey(project.id, tab.id)
      if (key === tabKey) return resolveTabLabel(tab, $tabMeta.get()[key]?.cwd)
    }
  }
  return null
}

/** The toast for a phone that is (still) present, if its state changed. */
function presentToast(
  key: string,
  { dev, tabKey }: DevicePresence,
  before: MobileSubscriberInfo | undefined,
): void {
  const tab = tabLabelForKey(tabKey)
  if (!before) {
    const route = routeOfAddress(dev.peer_ip)
    const where = [route, tab].filter(Boolean).join(' · ')
    presenceToast(key, `${dev.device_name} connected`, where, toast.success)
  } else if (before.status === 'idle' && dev.status === 'online') {
    presenceToast(key, `${dev.device_name} is online`, tab ?? '', toast.success)
  } else if (before.status === 'online' && dev.status === 'idle') {
    presenceToast(
      key,
      `${dev.device_name} is idle`,
      'No terminal open for 60 s',
    )
  }
}

/**
 * One toast per presence transition, in the vocabulary the phone uses:
 * connected (with its route), online, idle, went offline.
 */
function notifyPresenceTransitions(
  prev: Map<string, DevicePresence>,
  next: Map<string, DevicePresence>,
): void {
  for (const [key, presence] of next) {
    presentToast(key, presence, prev.get(key)?.dev)
  }
  for (const [key, { dev, tabKey }] of prev) {
    if (next.has(key)) continue
    const tab = tabLabelForKey(tabKey)
    presenceToast(
      key,
      `${dev.device_name} went offline`,
      tab ? `Last seen on ${tab}` : 'Mobile session ended',
    )
  }
}

function applyMobileTabsUpdate(
  tabs: ActiveMobileTabsMap,
  notify: boolean,
): void {
  const nextPresence = presenceByDevice(tabs)
  if (notify) notifyPresenceTransitions(prevDeviceStates, nextPresence)
  prevDeviceStates = nextPresence
  $activeMobileTabs.set(tabs)
}

/** Each connected phone once, on the tab it is most present on. */
function presenceByDevice(
  tabs: ActiveMobileTabsMap,
): Map<string, DevicePresence> {
  const out = new Map<string, DevicePresence>()
  for (const [tabKey, devs] of Object.entries(tabs)) {
    for (const dev of devs) {
      const key = deviceKey(dev)
      const existing = out.get(key)
      if (
        !existing ||
        (existing.dev.status === 'idle' && dev.status === 'online')
      ) {
        out.set(key, { dev, tabKey })
      }
    }
  }
  return out
}

/**
 * How the desktop sees a paired phone right now, in the shared state
 * names: "Online on /home" or "Idle". Null when presence does not know
 * the phone: it tracks phones from their first tab on, so a phone that
 * is connected but has not opened a tab yet is not Offline, only unknown.
 */
export function devicePresence(
  tabs: ActiveMobileTabsMap,
  deviceId: string,
): string | null {
  const found = [...presenceByDevice(tabs).values()].find(
    (p) => p.dev.device_id === deviceId,
  )
  if (!found) return null
  if (found.dev.status === 'idle') return 'Idle'
  const tab = tabLabelForKey(found.tabKey)
  return tab ? `Online on ${tab}` : 'Online'
}

/**
 * Return unique connected mobile devices currently associated with `tabKey`.
 */
export function getTabMobileDevices(
  map: ActiveMobileTabsMap,
  tabKey: string,
): MobileSubscriberInfo[] {
  return dedupeDevices(map[tabKey] ?? [])
}

/**
 * Return unique connected mobile devices currently associated with any tab in `projectId`.
 */
export function getProjectMobileDevices(
  map: ActiveMobileTabsMap,
  projectId: string,
  tabIds: string[],
): MobileSubscriberInfo[] {
  return dedupeDevices(
    tabIds.flatMap((tabId) => map[makeTabKey(projectId, tabId)] ?? []),
  )
}

/**
 * Return all unique connected mobile devices across all tabs.
 */
export function getAllMobileDevices(
  map: ActiveMobileTabsMap,
): MobileSubscriberInfo[] {
  return dedupeDevices(Object.values(map).flat())
}

/**
 * Hydrate active mobile tab subscriptions and listen for live updates from
 * the Rust WSS server, which sends one only when something visible changed.
 * Installed once for the lifetime of the app; idempotent.
 */
export function installMobileActivityListener(): void {
  if (listenerInstalled) return
  listenerInstalled = true

  void invoke<ActiveMobileTabsMap>('list_active_mobile_tabs')
    .then((tabs) => applyMobileTabsUpdate(tabs, false))
    .catch(() => {})

  void listen<ActiveMobileTabsMap>('wss:mobile_subscriptions', (event) =>
    applyMobileTabsUpdate(event.payload, true),
  )
  // The desktop user closed a tab a phone was on. The phone is still
  // connected, so say nothing; a "disconnected" toast would be false.
  void listen<ActiveMobileTabsMap>('wss:mobile_subscriptions_pruned', (event) =>
    applyMobileTabsUpdate(event.payload, false),
  )
}
