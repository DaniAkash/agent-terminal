import type { DevicesState } from '@/modules/stores/$devices.types'
import type { Digest } from './push.sign.helpers'
import { canonical, signWith, timingSafeEqual } from './push.sign.helpers'
import { type PushData, pushDataSchema, type RouteDecision } from './push.types'

/**
 * Where a tapped notification should take the user, or why it should
 * not take them anywhere.
 *
 * Async because `expo-crypto`'s digest API is promise-based, so the
 * signature cannot be checked synchronously. Both callers already
 * await: the cold-start path awaits `getLastNotificationResponseAsync`
 * and the warm path is a listener, so this adds no new ordering risk.
 */
export async function decideRoute(
  raw: unknown,
  devices: DevicesState,
  keyFor: (deviceId: string) => Promise<string | null>,
  digest: Digest,
): Promise<RouteDecision> {
  // Version first, so a future payload shape reports as unsupported
  // rather than malformed and the log says something useful.
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'v' in raw &&
    (raw as { v: unknown }).v !== 1
  ) {
    return { kind: 'ignore', reason: 'unsupported-version' }
  }

  const parsed = pushDataSchema.safeParse(raw)
  if (!parsed.success) return { kind: 'ignore', reason: 'malformed' }
  const data: PushData = parsed.data

  // Cold start: a tap launched the app and `$devices` has not hydrated
  // from SecureStore yet. Routing against an empty map would silently
  // drop a valid tap, on the single most common path for this feature,
  // so park it for the resolver to replay.
  if (!devices.loaded) return { kind: 'park', data }

  const record = devices.byId[data.deviceId]
  if (!record) return { kind: 'ignore', reason: 'unknown-device' }

  // Verified after the device lookup, because the key IS that device's
  // pairing secret.
  const key = await keyFor(data.deviceId)
  if (!key) return { kind: 'ignore', reason: 'unknown-device' }
  const expected = await signWith(digest, key, canonical(data))
  if (!timingSafeEqual(data.sig, expected)) {
    return { kind: 'ignore', reason: 'bad-signature' }
  }

  return {
    kind: 'route',
    deviceId: data.deviceId,
    // The desktop already stripped the project prefix, so this matches
    // what `/tab/[projectId]/[tabId]` expects without further work.
    href: `/tab/${data.projectId}/${data.tabId}`,
    // The notification can come from a desktop that is not the one
    // currently selected. Switching first is what keeps the tab route
    // from resolving against the wrong desktop's project list.
    switchDesktop: data.deviceId !== devices.activeId,
  }
}

/**
 * Whether a push that arrived while the app is in the foreground should
 * be shown at all. A banner over the very screen it is about is noise.
 */
export function shouldPresentInForeground(
  data: PushData | null,
  activeDeviceId: string | null,
  visibleTabId: string | null,
): boolean {
  if (!data) return true
  const sameDesktop = data.deviceId === activeDeviceId
  const sameTab = visibleTabId === `${data.projectId}:${data.tabId}`
  return !(sameDesktop && sameTab)
}
