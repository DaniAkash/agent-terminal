/**
 * Pure decision helper for the `$activeDevice` subscriber in bootstrap.ts.
 * Extracted for the same reason as lifecycle.helpers.ts: the branching is
 * worth testing without a secure-store or a socket in the room.
 */

import type { SessionStatusHint } from './lifecycle.helpers'

export type DeviceAction = 'skip' | 'connect' | 'switch'

/**
 * Decide what the subscriber should do for the desktop now marked active.
 *
 * - No record (never paired, or just revoked) -> nothing to connect to.
 * - Already driving this desktop and the socket is up or coming up -> leave
 *   it alone. Re-fires are routine: the record is rewritten every time the
 *   resolver learns a working endpoint.
 * - A different desktop than the one being driven -> `switch`. The live
 *   socket carries the previous desktop's token and tab subscriptions, so it
 *   has to come down first; otherwise the UI would point at the new desktop
 *   while the terminal kept streaming from the old one.
 * - Otherwise (same desktop, socket down or given up) -> `connect`, which is
 *   also the retry after an exhausted ladder.
 */
export function decideDeviceAction(
  drivenDeviceId: string | null,
  activeDeviceId: string | null,
  status: SessionStatusHint,
): DeviceAction {
  if (activeDeviceId === null) return 'skip'
  if (drivenDeviceId === activeDeviceId) {
    return status === 'connected' || status === 'connecting' ? 'skip' : 'connect'
  }
  return drivenDeviceId === null ? 'connect' : 'switch'
}
