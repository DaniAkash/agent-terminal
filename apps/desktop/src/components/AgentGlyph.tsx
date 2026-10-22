import type { TabVisual } from '@agent-terminal/core-ui'
import { AgentMarkSvg } from '@/components/AgentMarkSvg'

type AgentVisual = Extract<TabVisual, { kind: 'agent' }>

/* ---------------------------------------------------------------------------
 * Fallback for an agent this build has no brand entry for.
 * -------------------------------------------------------------------------*/

function SparkleFallback({
  visual,
  size,
}: {
  visual: AgentVisual
  size: number
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        color: '#c4b5fd',
        fontSize: Math.max(8, size * 0.7),
        lineHeight: 1,
        opacity: visual.dimmed ? 0.5 : 0.9,
      }}
      aria-hidden="true"
    >
      ✦
    </span>
  )
}

/* ---------------------------------------------------------------------------
 * AgentGlyph — brand mark plus state badge.
 *
 * Every decision here arrives in `visual`, derived by the shared package
 * so the companion reaches the same one from the same session. This file
 * only turns those decisions into DOM.
 *
 *   idle        → dim desaturated mark, no badge
 *   in-progress → full-opacity mark + pulsing brand-tinted ring
 *   completed   → mark scaled down + green check badge (bottom-right)
 *   awaiting    → mark scaled down + amber chat-bubble badge (top-right)
 * -------------------------------------------------------------------------*/

export function AgentGlyph({
  visual,
  size = 16,
}: {
  visual: AgentVisual
  size?: number
}) {
  if (!visual.art) return <SparkleFallback visual={visual} size={size} />

  const { color, glow } = visual.art.brand
  const state = visual.state

  const markFilter =
    state === 'idle'
      ? 'saturate(0.6)'
      : state === 'in-progress'
        ? `drop-shadow(0 0 5px ${glow})`
        : 'none'
  // Shrink the mark slightly when a corner badge needs room
  const hasBadge = state === 'completed' || state === 'awaiting'
  const badgeSize = Math.max(8, Math.round(size * 0.46))

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {visual.pulses && (
        <span
          style={{
            position: 'absolute',
            inset: -3,
            borderRadius: '50%',
            border: `1px solid ${color}`,
            opacity: 0.4,
            animation: 'pulse-ring 1.6s ease-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}

      <span
        style={{
          color,
          opacity: visual.dimmed ? 0.45 : 1,
          filter: markFilter,
          transform: `scale(${hasBadge ? 0.82 : 1})`,
          transformOrigin: hasBadge ? '30% 30%' : '50% 50%',
          transition: 'opacity 180ms, filter 220ms, transform 220ms',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AgentMarkSvg mark={visual.art.mark} size={size} />
      </span>

      {state === 'completed' && <CompletedBadge size={badgeSize} />}
      {state === 'awaiting' && <AwaitingBadge size={badgeSize} />}
    </span>
  )
}

/** Green check, bottom-right. */
function CompletedBadge({ size }: { size: number }) {
  const tick = Math.round(size * 0.65)
  return (
    <span
      style={{
        position: 'absolute',
        right: -Math.round(size * 0.15),
        bottom: -Math.round(size * 0.15),
        width: size,
        height: size,
        borderRadius: size,
        background: 'var(--running-dot)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 0 0 1.5px var(--background)',
        color: 'var(--background)',
      }}
    >
      <svg
        width={tick}
        height={tick}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        // Inline size pins this against cmdk's descendant-SVG sizing rule,
        // which would otherwise inflate the tick to 16px inside an 8px
        // badge. Same reason as AgentMarkSvg.
        style={{ width: tick, height: tick }}
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  )
}

/** Amber chat bubble, top-right, breathing. */
function AwaitingBadge({ size }: { size: number }) {
  return (
    <span
      style={{
        position: 'absolute',
        right: -Math.round(size * 0.2),
        top: -Math.round(size * 0.2),
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'agent-breathe 1.8s ease-in-out infinite',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="#e0af68"
        stroke="var(--background)"
        strokeWidth="1.4"
        strokeLinejoin="round"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <path d="M3.2 4.5 A 1.8 1.8 0 0 1 5 2.7 h 14 A 1.8 1.8 0 0 1 20.8 4.5 v 10 A 1.8 1.8 0 0 1 19 16.3 H 10.3 l -4.6 3.8 a 0.5 0.5 0 0 1 -0.8 -0.4 v -3.4 H 5 A 1.8 1.8 0 0 1 3.2 14.5 z" />
        <circle
          cx="8"
          cy="9.5"
          r="1.3"
          fill="var(--background)"
          stroke="none"
        />
        <circle
          cx="12"
          cy="9.5"
          r="1.3"
          fill="var(--background)"
          stroke="none"
        />
        <circle
          cx="16"
          cy="9.5"
          r="1.3"
          fill="var(--background)"
          stroke="none"
        />
      </svg>
    </span>
  )
}
