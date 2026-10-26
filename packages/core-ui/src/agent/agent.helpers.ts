import { AGENT_MARKS } from './agent.marks'
import { AGENT_BRANDS, FULL_PERMISSION_FLAGS } from './agent.registry'
import {
  type AgentArt,
  type AgentGlyphState,
  DONE_LINGER_MS,
  type ShellDot,
  type TabVisual,
  type TabVisualInput,
  type WireTabState,
} from './agent.types'

/**
 * Whether an agent command carries a full-permissions flag.
 *
 * Only the desktop can call this: `agentCmd` is renderer state and never
 * crosses the wire, by design, because it can hold an API key or an
 * absolute home path. The desktop evaluates it and sends the boolean.
 *
 * Matched token by token rather than as a substring, because the answer
 * ends up on the phone as a trust badge and a substring search calls
 * `--model my--yolo-model` dangerous. Splitting each token on `=` keeps
 * `--yolo=true` recognised, and a flag never contains whitespace, so a
 * quoted value lands in a token of its own and cannot be mistaken for
 * one.
 */
export function hasDangerFlag(agentCmd: string | undefined): boolean {
  if (!agentCmd) return false
  return agentCmd.split(/\s+/).some(isFullPermissionFlag)
}

function isFullPermissionFlag(token: string): boolean {
  const value = token.indexOf('=')
  const flag = value === -1 ? token : token.slice(0, value)
  return FULL_PERMISSION_FLAGS.includes(flag)
}

/**
 * The badge an agent's mark wears, from the one state the wire carries.
 *
 * Nothing is lost collapsing through `WireTabState`: `running` is a turn
 * in flight, `awaiting` is a question on screen, and both `done` and
 * `error` are a finished turn. That last pair is deliberate. There is no
 * reliable way to tell a clean agent exit from a failed one at the OSC
 * 133 level, so claiming failure would be a guess dressed as a fact.
 */
function agentStateFor(state: WireTabState): AgentGlyphState {
  if (state === 'awaiting') return 'awaiting'
  if (state === 'running') return 'in-progress'
  if (state === 'done' || state === 'error') return 'completed'
  return 'idle'
}

/**
 * The dot a plain shell tab shows, including the linger on a finished
 * command.
 *
 * A green dot that never goes out stops meaning "this just finished", so
 * it expires. The timestamp is the wire's own transition stamp rather
 * than a timer, because the two apps cannot share a timer and a stamp
 * both can read is the only version of this that agrees across devices.
 * A `done` with no stamp stays lit rather than guessing, which is what a
 * tree loaded from disk before the first sync looks like.
 */
function shellDotFor(
  state: WireTabState,
  stateAt: number | undefined,
  now: number,
): ShellDot {
  if (state === 'running') return 'running'
  if (state === 'error') return 'error'
  if (state !== 'done') return 'idle'
  if (stateAt === undefined) return 'done'
  return now - stateAt < DONE_LINGER_MS ? 'done' : 'idle'
}

/**
 * An agent's artwork, or null when this build has no entry for the id.
 *
 * Both halves are looked up together because a brand without geometry
 * cannot be drawn, so there is no partial answer worth returning.
 */
export function agentArt(agentId: string): AgentArt | null {
  const brand = AGENT_BRANDS[agentId]
  const mark = AGENT_MARKS[agentId]
  return brand && mark ? { brand, mark } : null
}

const LABELS: Record<WireTabState, string> = {
  awaiting: 'needs you',
  running: 'running',
  done: 'done',
  error: 'failed',
  idle: 'idle',
}

/**
 * Everything needed to draw one session's icon, derived once so the two
 * apps cannot reach different conclusions from the same session.
 *
 * Note that an agent's finished turn does NOT expire the way a shell's
 * does. A command that exited is news for a few seconds; an agent that
 * finished its turn is a thing you still need to go and read, and it
 * stays marked until you open it. That split is what the desktop already
 * does, with the linger living in the shell branch of `TabStatusIcon`
 * and the agent branch ignoring it, and it is now what mobile does too.
 */
export function deriveTabVisual(input: TabVisualInput, now: number): TabVisual {
  const label = LABELS[input.state]

  if (input.agentId === undefined || input.agentId === '') {
    const dot = shellDotFor(input.state, input.stateAt, now)
    return {
      kind: 'shell',
      dot,
      pulses: dot === 'running',
      showDanger: false,
      label: dot === 'idle' ? LABELS.idle : label,
    }
  }

  const state = agentStateFor(input.state)
  return {
    kind: 'agent',
    agentId: input.agentId,
    art: agentArt(input.agentId),
    state,
    pulses: state === 'in-progress',
    dimmed: state === 'idle' && input.active !== true,
    showDanger: input.fullPermissions === true,
    label,
  }
}

/**
 * When a lit shell dot should go out, or null when nothing is waiting to
 * expire. A caller arms one timer off this rather than polling a clock.
 */
export function doneExpiresAt(
  input: Pick<TabVisualInput, 'agentId' | 'state' | 'stateAt'>,
): number | null {
  if (input.agentId) return null
  if (input.state !== 'done' || input.stateAt === undefined) return null
  return input.stateAt + DONE_LINGER_MS
}
