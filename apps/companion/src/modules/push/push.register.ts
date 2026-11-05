import { sendRegisterPush, sendUnregisterPush } from '@/modules/wss/client'
import { $push } from './$push'
import { registrationAction } from './push.register.helpers'
import { appVersion, platformName } from './push.token'

/**
 * Tell the desktop what this device wants, if anything.
 *
 * The decision is in `registrationAction`, which is where the gate on
 * the desktop's capability frame lives and where it is tested. This is
 * only the dispatch.
 *
 * Driven by a subscription in `initPush` rather than called from the
 * socket code, so the dependency arrow points one way: this module
 * imports the client, and the client imports only the store.
 *
 * Re-sent on every connect rather than only on change, because Expo
 * tokens rotate and one that rotated while the desktop was offline
 * would otherwise leave push quietly broken until the next pairing.
 */
export function syncRegistration(): void {
  const { desktop, prefs, token } = $push.get()
  const action = registrationAction({ desktop, prefs, token })

  if (action.kind === 'register') {
    void sendRegisterPush({
      token: action.token,
      platform: platformName(),
      app_version: appVersion(),
      delay_seconds: action.delaySeconds,
      redact_names: action.redactNames,
    }).catch((err) => console.warn('[push] register failed:', err))
    return
  }
  if (action.kind === 'unregister') {
    void sendUnregisterPush().catch((err) =>
      console.warn('[push] unregister failed:', err),
    )
  }
}
