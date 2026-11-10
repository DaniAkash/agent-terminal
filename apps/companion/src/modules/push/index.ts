import * as Notifications from 'expo-notifications'
import { $push, loadPushPrefs } from './$push'
import { syncRegistration } from './push.register'
import { createChannels } from './push.channels'
import { installForegroundHandler } from './push.handler'
import { shouldHydrateToken } from './push.register.helpers'
import { handlePushData, installResponseListener } from './push.routing'
import { fetchToken, refreshPermission } from './push.token'

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

  // Re-assert registration whenever anything it depends on moves: the
  // desktop's capability frame arriving, a token being fetched, the
  // user flipping a preference. Re-sending on every connect rather
  // than only on change is deliberate, since Expo tokens rotate and
  // one that rotated while the desktop was offline would otherwise
  // leave push quietly broken until the next pairing.
  $push.listen(() => syncRegistration())

  // Listeners are installed unconditionally, before anything that could
  // decide this device is unsupported. An earlier version returned early
  // on `!Device.isDevice`, which skipped them: any notification that did
  // arrive was then silently unroutable, and a tap did nothing at all.
  // That boolean is also wrong on iOS, where a simulator on a recent
  // Xcode receives push perfectly well. Whether this device can register
  // is answered by actually asking for a token, not by guessing from the
  // platform.
  //
  // Channels come first regardless: a push naming a channel the device
  // does not have is not displayed at all.
  await createChannels()
  installForegroundHandler()
  installResponseListener()
  await refreshPermission()

  // Hydration must not read as an opt-out. The token lives in process
  // memory only, so a cold start leaves an enabled preference with no
  // token beside it, and the registration gate reads that pair as the
  // user having switched push off: it sends UnregisterPush and the
  // desktop drops the registration, until the switch is toggled by
  // hand. Fetching one here closes that hole. Still no permission
  // request: this only uses permission the user has already granted.
  const { permission, prefs, token } = $push.get()
  if (shouldHydrateToken({ enabled: prefs.enabled, permission, token })) {
    await fetchToken()
  }

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
export { clearVisibleTab, noteVisibleTab } from './$visibleTab'
export { enablePush } from './push.token'
