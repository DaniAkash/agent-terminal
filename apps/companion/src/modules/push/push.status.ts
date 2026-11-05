import { $push } from './$push'
import { syncRegistration } from './push.register'
import type { DesktopPushStatus } from './push.types'

/**
 * Record what the desktop said about push, then re-assert this
 * device's registration.
 *
 * Split into its own file so `wss/client.ts` can import it without
 * pulling the whole push module, and so the register-on-arrival
 * behaviour lives beside the state it depends on rather than inside
 * the socket code.
 */
export function noteDesktopPushStatus(status: DesktopPushStatus): void {
  $push.setKey('desktop', status)
  // Re-asserted on every connect, not only when something changed:
  // Expo tokens rotate, and one that rotated while the desktop was
  // offline would otherwise leave push quietly broken until the next
  // pairing.
  syncRegistration()
}
