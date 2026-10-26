import {
  deriveTabVisual,
  doneExpiresAt as sharedDoneExpiresAt,
  type TabVisual,
  type TabVisualInput,
  type WireTabState,
} from '@agent-terminal/core-ui'
import type { TabSummary } from '@/modules/wss/protocol.gen'

/**
 * The phone's adapter onto the shared vocabulary.
 *
 * Everything the glyph needs is already on the wire, derived once on the
 * desktop and sent rather than re-decided here. What is left is reading
 * the fields off a `TabSummary` and handing them to the same function
 * the desktop draws from, so a session cannot look like one thing on the
 * laptop and another on the phone.
 */
export function tabVisualFor(
  tab:
    | Pick<
        TabSummary,
        'agent_state' | 'agent_state_at' | 'agent_id' | 'full_permissions'
      >
    | undefined,
  now: number,
  active = false,
): TabVisual {
  return deriveTabVisual(visualInput(tab, active), now)
}

function visualInput(
  tab:
    | Pick<
        TabSummary,
        'agent_state' | 'agent_state_at' | 'agent_id' | 'full_permissions'
      >
    | undefined,
  active: boolean,
): TabVisualInput {
  return {
    // The desktop only ever sends the five words `WireTabState` lists,
    // but it is a plain string on the wire and an older desktop could
    // send something else. An unrecognised value reads as idle rather
    // than crashing a list the user is trying to scroll.
    state: asWireState(tab?.agent_state),
    stateAt: tab?.agent_state_at,
    agentId: tab?.agent_id,
    fullPermissions: tab?.full_permissions,
    active,
  }
}

const WIRE_STATES: readonly string[] = [
  'idle',
  'running',
  'done',
  'error',
  'awaiting',
]

function asWireState(value: string | undefined): WireTabState {
  return value !== undefined && WIRE_STATES.includes(value)
    ? (value as WireTabState)
    : 'idle'
}

/**
 * When a lit dot should go out, so the caller can arm one timer rather
 * than poll a clock.
 *
 * The phone needs this and the desktop does not: the desktop stops
 * sending frames once a turn ends, so without a timer nothing would ever
 * prompt the re-render that dims the dot.
 */
export function doneExpiresAt(
  tab:
    | Pick<TabSummary, 'agent_state' | 'agent_state_at' | 'agent_id'>
    | undefined,
): number | null {
  return sharedDoneExpiresAt({
    state: asWireState(tab?.agent_state),
    stateAt: tab?.agent_state_at,
    agentId: tab?.agent_id,
  })
}

/** Uniwind class for a dot, by the state the shared derivation picked. */
export function dotClass(visual: TabVisual): string {
  if (visual.kind === 'agent') {
    if (visual.state === 'awaiting') return 'bg-warning'
    if (visual.state === 'in-progress' || visual.state === 'completed') {
      return 'bg-success'
    }
    return 'bg-muted-foreground/40'
  }
  if (visual.dot === 'running' || visual.dot === 'done') return 'bg-success'
  if (visual.dot === 'error') return 'bg-destructive'
  return 'bg-muted-foreground/40'
}
