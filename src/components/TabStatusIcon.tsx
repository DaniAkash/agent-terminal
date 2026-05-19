import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { AgentGlyph } from '@/components/AgentGlyph'
import { deriveAgentState } from '@/components/agent.helpers'
import { RunningDot } from '@/components/RunningDot'
import { $tabMeta, updateTabMeta } from '@/modules/stores/$tabMeta'

type Props = {
  tabId: string
  active?: boolean
}

/**
 * Status indicator for tab pills and sidebar rows.
 * Reads from `$tabMeta` (driven by ProcessTrackerMod + ClaudeCodeMod/CodexMod).
 *
 * ── Shell / task state machine ───────────────────────────────────────────────
 *
 *   running ──► animated RunningDot (pulsing green)
 *      │
 *      ▼ (exit 0)
 *   done ────► static green dot  ──► [10s elapsed OR tab becomes active] ──► idle
 *      │
 *      │ (exit non-0, bypasses done)
 *      ▼
 *   error ───► static red dot  (persists until the shell starts running again —
 *              error is actionable and should not self-clear)
 *      │
 *      ▼ (user runs another command)
 *   running  (cycle repeats)
 *
 *   idle ────► dim static dot
 *
 * The "done" green is intentionally transient — it signals completion but
 * becomes stale once acknowledged. Two things clear it:
 *   1. 10 seconds elapse (auto-dismiss for unattended tabs)
 *   2. The tab becomes active (user has seen it — clear immediately)
 * Either path transitions the visual to "idle" (dim dot).
 *
 * ── Agent ────────────────────────────────────────────────────────────────────
 *
 *   Renders AgentGlyph with the agent's brand mark.
 *   idle   → dim mark (full opacity when the tab/sidebar item is active)
 *   done   → green check badge (bottom-right corner of the mark)
 *   error  → green check badge (same as done — see TECH DEBT note in agent.helpers.ts)
 *
 *   `in-progress` (pulsing ring) and `awaiting` (amber chat-bubble badge)
 *   are defined in AgentState but not yet returned by deriveAgentState —
 *   AgentTurnMod will unlock them when it writes agentState to TabMeta.
 */

export function TabStatusIcon({ tabId, active = false }: Props) {
  const allMeta = useStore($tabMeta)
  const meta = allMeta[tabId]
  const status = meta?.status ?? 'idle'
  const type = meta?.type ?? 'shell'
  // showDone derived from the store — every instance of this component for
  // the same tab agrees on the visual. The 10s linger is enforced by a
  // single per-tab setTimeout in mod-listener that clears `doneAt` directly.
  const showDone = meta?.doneAt !== undefined

  // Navigating to the tab counts as acknowledgement — clear the done stamp
  // immediately so the green dot disappears across every surface (sidebar,
  // tab bar, palette) in the same tick.
  useEffect(() => {
    if (active && showDone) updateTabMeta(tabId, { doneAt: undefined })
  }, [active, showDone, tabId])

  if (type === 'agent') {
    return (
      <AgentGlyph
        agent={meta?.agentId ?? ''}
        state={deriveAgentState(meta)}
        size={14}
        active={active}
      />
    )
  }

  if (status === 'running') return <RunningDot />

  if (showDone) {
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
