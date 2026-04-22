import type { TabMeta } from '@/modules/stores/$tabMeta'

/**
 * The four visual states an agent tab can be in.
 *
 * - idle        : process exists, no active turn (dim mark)
 * - in-progress : agent is producing output (pulsing ring)
 * - completed   : last turn finished, waiting for next prompt (green check badge)
 * - awaiting    : agent is waiting for user confirmation (amber chat-bubble badge)
 *
 * `completed` and `awaiting` are future states — `deriveAgentState` never
 * returns them yet. When the AgentTurnMod is built it will write
 * `TabMeta.agentState` directly; update this helper to prefer that field.
 */
export type AgentState = 'idle' | 'in-progress' | 'completed' | 'awaiting'

/**
 * Maps live TabMeta → AgentState for rendering.
 *
 * Future hook: when TabMeta gains an `agentState` field set by AgentTurnMod,
 * add `if (meta.agentState) return meta.agentState` before the status mapping.
 */
export function deriveAgentState(meta: TabMeta | undefined): AgentState {
  if (!meta || meta.type !== 'agent') return 'idle'
  if (meta.status === 'running') return 'in-progress'
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
