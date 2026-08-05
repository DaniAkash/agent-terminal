import type { TabMeta } from '@/modules/stores/$tabMeta'

/**
 * The four visual states an agent tab can be in.
 *
 * - idle        : process exists, no active turn (dim mark)
 * - in-progress : agent is producing output (pulsing ring)
 * - completed   : session ended — green check badge (bottom-right)
 * - awaiting    : agent is waiting for user confirmation (amber chat-bubble badge)
 *
 * Currently `deriveAgentState` returns `idle` and `completed` only.
 * `in-progress` and `awaiting` are unlocked when AgentTurnMod writes
 * `TabMeta.agentState` directly; add `if (meta.agentState) return meta.agentState`
 * as the first check in `deriveAgentState` at that point.
 */
export type AgentState = 'idle' | 'in-progress' | 'completed' | 'awaiting'

/**
 * Maps live TabMeta → AgentState for rendering.
 *
 * `in-progress` and `awaiting` are intentionally not returned here yet — we
 * have no signal that distinguishes "agent process is alive" from "agent is
 * actively producing output". OSC 133 status only tells us the shell is
 * running, not whether the agent turn is in flight.
 *
 * When AgentTurnMod is built it will write `TabMeta.agentState` directly.
 * At that point, add `if (meta.agentState) return meta.agentState` as the
 * first check below, and the richer states will light up automatically.
 *
 * TECH DEBT: Both `done` and `error` map to `completed` (green check badge).
 * Error exits should ideally show a distinct red badge, but we have no
 * reliable way to distinguish a clean agent exit from an error exit at the
 * OSC 133 level today. Treat any session end as successful for now and
 * revisit when AgentTurnMod provides richer exit metadata.
 */
export function deriveAgentState(meta: TabMeta | undefined): AgentState {
  if (meta?.type !== 'agent') return 'idle'
  // Hook data from AgentTurnMod takes priority — richer and more accurate.
  if (meta.agentState) return meta.agentState
  // Fallback: OSC 133 process exit signals a completed session.
  if (meta.status === 'done' || meta.status === 'error') return 'completed'
  return 'idle'
}

/**
 * Returns true when the agent command includes a full-permissions flag.
 *
 * Per-agent flags:
 *   - claude-code → --dangerously-skip-permissions
 *   - codex       → --yolo
 *
 * When adding a new agent, add its full-permissions flag here.
 * The 🤘 badge and tooltip are the same regardless of which flag triggered it.
 */
export function hasDangerFlag(agentCmd: string | undefined): boolean {
  if (!agentCmd) return false
  return (
    agentCmd.includes('--dangerously-skip-permissions') ||
    agentCmd.includes('--yolo')
  )
}

/**
 * Parses the `--model <name>` flag from an agent command string.
 * Returns null when the flag is absent.
 */
export function parseModelFlag(agentCmd: string | undefined): string | null {
  if (!agentCmd) return null
  const match = agentCmd.match(/--model\s+(\S+)/)
  return match?.[1] ?? null
}

/**
 * Composed decision for whether TabChip should render the DangerBadge for
 * a given tab. All three inputs must line up:
 *   1. The consuming surface opted in via `showDanger`
 *   2. The tab is an agent tab (shell tabs never show a danger badge)
 *   3. The agent was launched with a full-permissions flag
 *
 * Split out from the render body so it stays pure and testable, and so the
 * combinatorics live in one place rather than at every consuming site.
 */
export function shouldShowDangerBadge(
  meta: TabMeta | undefined,
  showDanger: boolean,
): boolean {
  if (!showDanger) return false
  if (meta?.type !== 'agent') return false
  return hasDangerFlag(meta.agentCmd)
}
