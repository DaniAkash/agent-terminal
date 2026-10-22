import type { TabVisual } from '@agent-terminal/core-ui'
import { AgentGlyph } from '@/components/AgentGlyph'
import { RunningDot } from '@/components/RunningDot'

/**
 * Status indicator for tab pills and sidebar rows.
 *
 * Every decision is already made: `visual` comes from the shared
 * package's `deriveTabVisual`, which the companion also calls, so the
 * same session cannot look like two different things on the two devices.
 * This file turns a decision into DOM and does nothing else.
 *
 * ── Shell ────────────────────────────────────────────────────────────────
 *
 *   running ──► animated RunningDot (pulsing green)
 *   done ────► static green dot, for ten seconds from the transition
 *   error ───► static red dot, which does not expire, because a failure
 *              stays actionable until something else happens
 *   idle ────► dim static dot
 *
 * ── Agent ────────────────────────────────────────────────────────────────
 *
 *   The brand mark, with a badge for the turn state. A finished turn
 *   keeps its badge rather than expiring: an exited command is news for a
 *   few seconds, an agent waiting to be read is not.
 */
export function TabStatusIcon({
  visual,
  size = 14,
}: {
  visual: TabVisual
  /**
   * Icon size in pixels for the AgentGlyph. Default 14 matches the
   * current uniform density across sidebar / tab bar / command palette.
   */
  size?: number
}) {
  if (visual.kind === 'agent') {
    return <AgentGlyph visual={visual} size={size} />
  }

  if (visual.dot === 'running') return <RunningDot />

  if (visual.dot === 'done') {
    return (
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400 opacity-70" />
    )
  }

  if (visual.dot === 'error') {
    return (
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400 opacity-70" />
    )
  }

  return (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-35" />
  )
}
