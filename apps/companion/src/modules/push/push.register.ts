import { sendRegisterPush, sendUnregisterPush } from '@/modules/wss/client'
import { $push } from './$push'
import { appVersion, platformName } from './push.token'

/**
 * The registration gate.
 *
 * Never call `sendRegisterPush` directly. The desktop closes the whole
 * WebSocket when it cannot deserialise a `ClientFrame`, so registering
 * against a Mac app older than this feature does not merely fail to
 * register: it disconnects the terminal stream, on every connect. The
 * `PushStatus` frame the desktop sends right after `AuthOk` is the
 * capability advertisement, and `$push.desktop` is non-null only once
 * it has arrived.
 *
 * Idempotent, and called from both the connect path and the settings
 * screen, so preferences are re-asserted on every connect. That doubles
 * as the recovery path when a desktop lost its record, and when an Expo
 * token rotated while the desktop was offline.
 */
export function syncRegistration(): void {
  const { desktop, prefs, token } = $push.get()
  if (!desktop?.supported) return

  if (!prefs.enabled || !token) {
    if (desktop.registered) {
      void sendUnregisterPush().catch((err) => {
        console.warn('[push] unregister failed:', err)
      })
    }
    return
  }

  void sendRegisterPush({
    token,
    platform: platformName(),
    app_version: appVersion(),
    delay_seconds: prefs.delaySeconds,
    redact_names: prefs.redactNames,
  }).catch((err) => {
    console.warn('[push] register failed:', err)
  })
}
