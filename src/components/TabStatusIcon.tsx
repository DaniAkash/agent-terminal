import { useStore } from '@nanostores/react'
import { AgentGlyph } from '@/components/AgentGlyph'
import { deriveAgentState } from '@/components/agent.helpers'
import { RunningDot } from '@/components/RunningDot'
import { $tabMeta } from '@/modules/stores/$tabMeta'

type Props = {
  tabId: string
  active?: boolean
}

/**
 * Status indicator for tab pills and sidebar rows.
 * Reads from `$tabMeta` (driven by ProcessTrackerMod + ClaudeCodeMod/CodexMod).
 *
 * Shell / task:
 *   running → animated RunningDot (pulsing green)
 *   done    → static green dot
 *   error   → static red dot
 *   idle    → dim static dot
 *
 * Agent:
 *   Renders AgentGlyph with the agent's brand mark and a state badge.
 *   State is derived from OSC 133 status today; AgentTurnMod will enrich
 *   this with completed / awaiting states in the future.
 */
export function TabStatusIcon({ tabId, active = false }: Props) {
  const allMeta = useStore($tabMeta)
  const meta = allMeta[tabId]
  const status = meta?.status ?? 'idle'
  const type = meta?.type ?? 'shell'

  if (type === 'agent') {
    return (
      <AgentGlyph
        agent={meta?.agentName ?? ''}
        state={deriveAgentState(meta)}
        size={14}
        active={active}
      />
    )
  }

  if (status === 'running') return <RunningDot />

  if (status === 'done') {
    return (
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400 opacity-70" />
    )
  }

  if (status === 'error') {
    return (
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400 opacity-70" />
    )
  }

  return (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-35" />
  )
}
