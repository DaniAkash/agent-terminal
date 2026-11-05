import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { $devices, setActiveDevice } from '@/modules/stores/$devices'
import { $push } from './$push'
import { decideRoute } from './push.routing.helpers'
import { deriveKey, digest } from './push.sign'
import type { RouteDecision } from './push.types'

/**
 * Side-effecting shell around `decideRoute`. Every decision lives in
 * the pure helper; this only applies one.
 */

/** The signing key is the pairing secret, so it comes from the device
 *  record rather than anywhere push-specific. */
async function keyFor(deviceId: string): Promise<string | null> {
  const record = $devices.get().byId[deviceId]
  if (!record) return null
  return deriveKey(record.token)
}

export async function handlePushData(raw: unknown): Promise<RouteDecision> {
  const decision = await decideRoute(raw, $devices.get(), keyFor, digest)
  await applyRoute(decision)
  return decision
}

async function applyRoute(decision: RouteDecision): Promise<void> {
  if (decision.kind === 'park') {
    $push.setKey('pendingRoute', decision.data)
    return
  }
  if (decision.kind === 'ignore') {
    console.warn(`[push] ignoring a notification tap: ${decision.reason}`)
    return
  }
  // Switching first matters: the tab route resolves its ids against
  // whichever desktop is active, so navigating before the switch would
  // look this tab up in the wrong desktop's project list.
  if (decision.switchDesktop) await setActiveDevice(decision.deviceId)
  router.push(decision.href as Parameters<typeof router.push>[0])
}

/**
 * Taps while the app is running. The cold-start half is in `index.ts`,
 * because it has to run once before the first navigation rather than
 * as a subscription.
 */
export function installResponseListener(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      void handlePushData(response.notification.request.content.data)
    },
  )
  return () => sub.remove()
}
