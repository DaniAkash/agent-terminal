import { sendRegisterPush, sendUnregisterPush } from '@/modules/wss/client'
import { $push, noteAssertion } from './$push'
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
 * The assertion is recorded BEFORE the frame goes out, on purpose. The
 * write re-enters this function through the same subscription, and the
 * second pass has to see the assertion already in place or it sends the
 * frame twice. A send that then fails clears it, so the next trigger
 * retries rather than treating a dropped frame as something the desktop
 * has stored.
 */
export function syncRegistration(): void {
  const { asserted, desktop, prefs, token } = $push.get()
  const action = registrationAction({ asserted, desktop, prefs, token })

  if (action.kind === 'register') {
    noteAssertion({
      kind: 'registered',
      token: action.token,
      delaySeconds: action.delaySeconds,
      redactNames: action.redactNames,
    })
    void sendRegisterPush({
      token: action.token,
      platform: platformName(),
      app_version: appVersion(),
      delay_seconds: action.delaySeconds,
      redact_names: action.redactNames,
    }).catch((err) => {
      console.warn('[push] register failed:', err)
      noteAssertion(null)
    })
    return
  }
  if (action.kind === 'unregister') {
    noteAssertion({ kind: 'cleared' })
    void sendUnregisterPush().catch((err) => {
      console.warn('[push] unregister failed:', err)
      noteAssertion(null)
    })
  }
}
