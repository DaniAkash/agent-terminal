import { BRAND, DEFAULT_MARK, MARKS } from '@/components/AgentGlyph.marks'
import type { AgentState } from '@/components/agent.helpers'

/* ---------------------------------------------------------------------------
 * Fallback for unknown agents — backwards-compatible violet sparkle
 * -------------------------------------------------------------------------*/

function SparkleFallback({
  state,
  size,
  active = false,
}: {
  state: AgentState
  size: number
  active?: boolean
}) {
  // Full opacity when the tab is selected (active) or the agent is running,
  // matching the same brightness logic used for branded marks.
  const dim = state === 'idle' && !active
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
        opacity: dim ? 0.5 : 0.9,
      }}
      aria-hidden="true"
    >
      ✦
    </span>
  )
}

/* ---------------------------------------------------------------------------
 * AgentGlyph — brand mark + state badge composite
 *
 * States:
 *   idle        → dim desaturated mark, no badge
 *   in-progress → full-opacity mark + pulsing brand-tinted ring
 *   completed   → mark scaled down + green check badge (bottom-right)
 *   awaiting    → mark scaled down + amber chat-bubble badge (top-right, breathing)
 *
 * Unknown agents render the violet ✦ sparkle for backwards compatibility.
 * Adding a new agent: add an entry to BRAND and a Mark component in
 * AgentGlyph.marks.tsx.
 * -------------------------------------------------------------------------*/

export function AgentGlyph({
  agent,
  state,
  size = 16,
  active = false,
}: {
  agent: string
  state: AgentState
  size?: number
  active?: boolean
}) {
  const brand = BRAND[agent]

  // Unknown agent → backwards-compatible sparkle (respects active state)
  if (!brand)
    return <SparkleFallback state={state} size={size} active={active} />

  const { color, glow } = brand
  const Mark = MARKS[agent] ?? DEFAULT_MARK

  const markOpacity = state === 'idle' && !active ? 0.45 : 1
  const markFilter =
    state === 'idle'
      ? 'saturate(0.6)'
      : state === 'in-progress'
        ? `drop-shadow(0 0 5px ${glow})`
        : 'none'
  // Shrink mark slightly when a corner badge needs room
  const hasBadge = state === 'completed' || state === 'awaiting'
  const markScale = hasBadge ? 0.82 : 1
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
      {/* In-progress — pulsing brand-tinted ring */}
      {state === 'in-progress' && (
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

      {/* Brand mark */}
      <span
        style={{
          color,
          opacity: markOpacity,
          filter: markFilter,
          transform: `scale(${markScale})`,
          transformOrigin: hasBadge ? '30% 30%' : '50% 50%',
          transition: 'opacity 180ms, filter 220ms, transform 220ms',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Mark size={size} />
      </span>

      {/* Completed — green check badge, bottom-right */}
      {state === 'completed' && (
        <span
          style={{
            position: 'absolute',
            right: -Math.round(badgeSize * 0.15),
            bottom: -Math.round(badgeSize * 0.15),
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize,
            background: 'var(--running-dot)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 0 1.5px var(--background)',
            color: 'var(--background)',
          }}
        >
          <svg
            width={Math.round(badgeSize * 0.65)}
            height={Math.round(badgeSize * 0.65)}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            // Inline width/height style pins the size against ancestor CSS
            // that would otherwise hijack it. cmdk's `[cmdk-item]` styles
            // include `[&_svg:not([class*='size-'])]:size-4`, which without
            // this style would inflate the check to 16px inside an 8px
            // badge circle (the exact shape of the "huge check" bug fixed
            // in this file when the TabSwitcher first got AgentGlyph icons).
            style={{
              width: Math.round(badgeSize * 0.65),
              height: Math.round(badgeSize * 0.65),
            }}
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
      )}

      {/* Awaiting — amber chat-bubble badge, top-right, breathing */}
      {state === 'awaiting' && (
        <span
          style={{
            position: 'absolute',
            right: -Math.round(badgeSize * 0.2),
            top: -Math.round(badgeSize * 0.2),
            width: badgeSize,
            height: badgeSize,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'agent-breathe 1.8s ease-in-out infinite',
          }}
        >
          <svg
            width={badgeSize}
            height={badgeSize}
            viewBox="0 0 24 24"
            fill="#e0af68"
            stroke="var(--background)"
            strokeWidth="1.4"
            strokeLinejoin="round"
            // Same inline-size pin as the completed badge above:
            // the cmdk force-sizing rule would inflate this awaiting
            // chat-bubble to 16px inside the TabSwitcher.
            style={{ width: badgeSize, height: badgeSize }}
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
      )}
    </span>
  )
}
