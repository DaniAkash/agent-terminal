import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { $push, loadPushPrefs } from './$push'
import { createChannels } from './push.channels'
import { installForegroundHandler } from './push.handler'
import { handlePushData, installResponseListener } from './push.routing'
import { refreshPermission } from './push.token'

let started = false

/**
 * Wire push once at app boot.
 *
 * Deliberately does NOT ask for permission: at boot the user has not
 * paired a desktop and cannot tell why the app wants notifications, so
 * they deny, and `requestPermissionsAsync` never prompts again. The ask
 * lives behind the pairing success screen and in settings.
 *
 * Registration is not attempted here either. It waits for the
 * desktop's `PushStatus` frame, because a Mac app older than this
 * feature closes the whole session on a frame it cannot deserialise.
 */
export async function initPush(): Promise<void> {
  if (started) return
  started = true

  await loadPushPrefs()

  if (!Device.isDevice) {
    // A simulator without Play services cannot register. Say so rather
    // than letting the settings screen offer a switch that throws.
    $push.setKey('support', 'unsupported')
    return
  }

  // Channels before anything else: a push naming a channel the device
  // does not have is not displayed at all.
  await createChannels()
  installForegroundHandler()
  installResponseListener()
  await refreshPermission()

  // The cold-start tap. Without this, a tap that launches the app from
  // killed lands on the home screen, which is the most likely state
  // for this app and so the most important path to get right. A tap
  // that arrives before the device store has hydrated is parked and
  // replayed by the resolver.
  const last = await Notifications.getLastNotificationResponseAsync()
  if (last) {
    await handlePushData(last.notification.request.content.data)
  }
}

export { $push, setPushPrefs, takePendingRoute } from './$push'
export { $visibleTab, clearVisibleTab, noteVisibleTab } from './$visibleTab'
export { applyPending } from './push.routing'
export { enablePush } from './push.token'
export { syncRegistration } from './push.register'
export { DELAY_CHOICES } from './push.types'
