import {
  hasDangerFlag,
  type TabVisualInput,
  type WireTabState,
} from '@agent-terminal/core-ui'
import type { AgentTurnState, TabMeta } from '@/modules/stores/$tabMeta'

/* ---------------------------------------------------------------------------
 * The desktop's adapter onto the shared vocabulary.
 *
 * `TabMeta` is a renderer-only shape with four overlapping state fields;
 * `@agent-terminal/core-ui` speaks one. Everything that turns the former
 * into the latter lives here, and both consumers go through it: the
 * renderer that draws the icon and the bridge that syncs the tree to
 * mobile.
 *
 * That shared path is the point. If the desktop derived what it draws
 * separately from what it sends, the two apps could still disagree about
 * the same session while both being internally consistent, which is the
 * precise failure the shared package exists to remove.
 * -------------------------------------------------------------------------*/

export { hasDangerFlag }

/**
 * Collapse the renderer's overlapping state fields into the one word the
 * wire and the shared glyph derivation both speak.
 *
 * Agent tabs read from `agentState`, which is the only field that can
 * express "awaiting", the state mobile most needs. When no hook data has
 * arrived the fallback is deliberately shy: OSC 133 says the shell is
 * running, which is not the same as the agent producing output, so an
 * unhooked agent reads idle rather than claiming a turn it cannot see.
 * Both `done` and `error` collapse to a finished turn, because nothing at
 * the OSC 133 level distinguishes a clean agent exit from a failed one.
 *
 * Shell tabs read from `status`, except that a `done` whose `doneAt` has
 * been cleared reads idle. Clearing is the acknowledgement: either the
 * ten second timer in mod-listener fired, or the user navigated to the
 * tab and saw it. A dot that outlived its own acknowledgement is noise.
 */
export function tabWireState(
  meta: TabMeta | undefined,
): WireTabState | undefined {
  if (!meta) return undefined

  if (meta.type === 'agent') {
    const turn: AgentTurnState | undefined = meta.agentState
    if (turn === 'awaiting') return 'awaiting'
    if (turn === 'in-progress') return 'running'
    if (turn === 'completed') return 'done'
    if (turn === 'idle') return 'idle'
    if (meta.status === 'done' || meta.status === 'error') return 'done'
    return 'idle'
  }

  if (meta.status === 'done' && meta.doneAt === undefined) return 'idle'
  return meta.status
}

/**
 * Which agent a tab runs, and whether it was launched with full
 * permissions.
 *
 * The verdict is computed here rather than carried as the command,
 * because `agentCmd` can hold an API key or an absolute home path and
 * the same value is what crosses the network to the phone.
 *
 * A shell tab reports neither, so a tab that stops being an agent stops
 * claiming one rather than keeping the last id it had.
 */
export function tabAgentIdentity(meta: TabMeta | undefined): {
  agentId?: string
  fullPermissions?: boolean
} {
  if (meta?.type !== 'agent') return {}
  const identity: { agentId?: string; fullPermissions?: boolean } = {
    fullPermissions: hasDangerFlag(meta.agentCmd),
  }
  if (meta.agentId) identity.agentId = meta.agentId
  return identity
}

/**
 * Everything `deriveTabVisual` needs, from one `TabMeta` snapshot.
 *
 * `doneAt` rather than a transition stamp: it is the moment the renderer
 * recorded the shell finishing, which is exactly what the shared done
 * linger counts from, and it is cleared both by the per-tab timer in
 * mod-listener and by the user navigating to the tab.
 */
export function tabVisualInput(
  meta: TabMeta | undefined,
  active = false,
): TabVisualInput {
  const identity = tabAgentIdentity(meta)
  return {
    state: tabWireState(meta) ?? 'idle',
    stateAt: meta?.doneAt,
    active,
    ...identity,
  }
}

/**
 * Parses the `--model <name>` flag from an agent command string.
 * Returns null when the flag is absent.
 *
 * Desktop-only: the status bar reads it off local `TabMeta`, and the raw
 * command never travels, so mobile has nothing to parse.
 */
export function parseModelFlag(agentCmd: string | undefined): string | null {
  if (!agentCmd) return null
  const match = agentCmd.match(/--model\s+(\S+)/)
  return match?.[1] ?? null
}
