import { map } from 'nanostores'
import type { TabStateSummary } from '@/modules/wss/protocol.gen'

/**
 * Latest `tab_state` the desktop pushed, keyed by composed tab id.
 *
 * The frame arrives on the terminal's own subscription, but the status
 * sheet is a separate route that never subscribes. Parking the last value
 * here lets the sheet open on what is already known instead of waiting for
 * the next push, and keeps the terminal from having to pass it along.
 */
export const $tabState = map<Record<string, TabStateSummary>>({})

export function noteTabState(tabId: string, state: TabStateSummary): void {
  $tabState.setKey(tabId, state)
}

/**
 * Drop everything learned from a connection that is going away.
 *
 * These entries are keyed by tab id alone, which is only unique within one
 * desktop. Two desktops can mint the same project and tab id, so carrying
 * the map across a switch risks showing one machine's working directory for
 * the other's session. Even on the same desktop a reconnect has not pushed
 * anything yet, and a stale directory is worse than a blank one: it is the
 * field someone checks before deciding where a command would run.
 */
export function clearTabStates(): void {
  $tabState.set({})
}
