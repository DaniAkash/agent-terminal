import { useEffect, useRef, useState } from 'react'
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
 *   error  → green check badge (OSC 133 maps both done/error → completed)
 *
 *   `in-progress` (pulsing ring) and `awaiting` (amber chat-bubble badge)
 *   are defined in AgentState but not yet returned by deriveAgentState —
 *   AgentTurnMod will unlock them when it writes agentState to TabMeta.
 */

/** How long (ms) the green "done" dot stays visible before fading to idle. */
const DONE_LINGER_MS = 10_000

export function TabStatusIcon({ tabId, active = false }: Props) {
  const allMeta = useStore($tabMeta)
  const meta = allMeta[tabId]
  const status = meta?.status ?? 'idle'
  const type = meta?.type ?? 'shell'

  // Controls whether the transient green "done" dot is currently visible.
  // Kept in local state rather than the store because it is purely a display
  // concern — the underlying status remains 'done' until the next command runs.
  const [showDone, setShowDone] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Start or cancel the linger timer whenever status changes.
  useEffect(() => {
    if (status === 'done') {
      setShowDone(true)
      timerRef.current = setTimeout(() => setShowDone(false), DONE_LINGER_MS)
    } else {
      // running / error / idle all cancel any in-flight timer immediately.
      setShowDone(false)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [status])

  // Navigating to the tab counts as "acknowledged" — clear the done dot right away.
  useEffect(() => {
    if (active && showDone) {
      setShowDone(false)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [active, showDone])

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
