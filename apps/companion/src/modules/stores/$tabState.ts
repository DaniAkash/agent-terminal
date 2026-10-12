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
