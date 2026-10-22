import type { AgentArt, TabVisual } from '@agent-terminal/core-ui'
import { useEffect, useRef } from 'react'
import { Animated, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { dotClass } from './tab-status.helpers'

const AWAITING_AMBER = '#e0af68'

/**
 * The same icon the desktop sidebar draws, in React Native.
 *
 * Every decision arrives in `visual`, made by the shared package the
 * desktop also calls, so this file only turns a decision into elements.
 * Three things do not survive the platform change and are not faked: the
 * CSS keyframes become an `Animated` loop, the completed badge's ring
 * becomes a border, and the in-progress drop-shadow glow is dropped
 * because React Native has no filter. The pulsing ring already says
 * "something is happening", so the glow was carrying no signal of its
 * own.
 */
export function SessionGlyph({
  visual,
  size = 14,
  connected = true,
}: {
  visual: TabVisual
  size?: number
  /**
   * False while the socket is down, which outranks whatever the agent
   * was last seen doing: a lit green dot over a dead connection is a lie.
   */
  connected?: boolean
}) {
  // A dead socket says nothing about what the agent is doing now, so the
  // dot reports the connection instead of the last thing it heard.
  if (!connected) {
    return <View className="h-2 w-2 rounded-full bg-destructive" />
  }
  // A shell, or an agent this build has no artwork for, is a dot.
  if (visual.kind === 'shell' || !visual.art) {
    return <Dot visual={visual} pulses={visual.pulses} />
  }
  return <AgentMark visual={visual} art={visual.art} size={size} />
}

/** The brand mark, with whatever badge the turn state calls for. */
function AgentMark({
  visual,
  art,
  size,
}: {
  visual: Extract<TabVisual, { kind: 'agent' }>
  // Passed in rather than read back off `visual`, because the caller's
  // null check does not survive into this component's own type.
  art: AgentArt
  size: number
}) {
  const { color } = art.brand
  const { viewBox, fillRule, paths } = art.mark
  const badge = Math.max(7, Math.round(size * 0.46))
  const markSize = markSizeFor(visual.state, size)

  return (
    <View
      style={{ width: size, height: size }}
      className="items-center justify-center"
    >
      {visual.pulses && <PulseRing size={size} color={color} />}
      <View style={{ opacity: visual.dimmed ? 0.45 : 1 }}>
        <Svg width={markSize} height={markSize} viewBox={viewBox}>
          {paths.map((d) => (
            <Path key={d} d={d} fill={color} fillRule={fillRule ?? 'nonzero'} />
          ))}
        </Svg>
      </View>
      <StateBadge state={visual.state} size={badge} />
    </View>
  )
}

/**
 * The mark shrinks when a corner badge needs room, matching the desktop,
 * which scales it by the same factor for the same two states.
 */
function markSizeFor(
  state: Extract<TabVisual, { kind: 'agent' }>['state'],
  size: number,
): number {
  const hasBadge = state === 'completed' || state === 'awaiting'
  return hasBadge ? Math.round(size * 0.82) : size
}

/** The corner badge a turn state calls for, if any. */
function StateBadge({
  state,
  size,
}: {
  state: Extract<TabVisual, { kind: 'agent' }>['state']
  size: number
}) {
  if (state === 'completed') return <CompletedBadge size={size} />
  if (state === 'awaiting') return <AwaitingBadge size={size} />
  return null
}

/** Plain dot for a shell tab, or an agent this build has no mark for. */
function Dot({ visual, pulses }: { visual: TabVisual; pulses: boolean }) {
  const opacity = usePulse(pulses)
  return (
    <Animated.View style={{ opacity }}>
      <View className={`h-2 w-2 rounded-full ${dotClass(visual)}`} />
    </Animated.View>
  )
}

function PulseRing({ size, color }: { size: number; color: string }) {
  const opacity = usePulse(true)
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: -3,
        left: -3,
        width: size + 6,
        height: size + 6,
        borderRadius: (size + 6) / 2,
        borderWidth: 1,
        borderColor: color,
        opacity,
      }}
    />
  )
}

/** Green circle with a tick, bottom-right. */
function CompletedBadge({ size }: { size: number }) {
  return (
    <View
      className="absolute items-center justify-center rounded-full border-background bg-success"
      style={{
        right: -Math.round(size * 0.15),
        bottom: -Math.round(size * 0.15),
        width: size,
        height: size,
        borderRadius: size,
        // The desktop pins this ring with a box-shadow, which React
        // Native has no equivalent for. A border does the same job.
        borderWidth: 1.5,
      }}
    >
      <Svg width={size * 0.65} height={size * 0.65} viewBox="0 0 24 24">
        <Path
          d="M20 6 9 17l-5-5"
          stroke="#0e0f10"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </View>
  )
}

/** Amber chat bubble, top-right, breathing. */
function AwaitingBadge({ size }: { size: number }) {
  const opacity = usePulse(true)
  return (
    <Animated.View
      style={{
        position: 'absolute',
        right: -Math.round(size * 0.2),
        top: -Math.round(size * 0.2),
        opacity,
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M3.2 4.5 A 1.8 1.8 0 0 1 5 2.7 h 14 A 1.8 1.8 0 0 1 20.8 4.5 v 10 A 1.8 1.8 0 0 1 19 16.3 H 10.3 l -4.6 3.8 a 0.5 0.5 0 0 1 -0.8 -0.4 v -3.4 H 5 A 1.8 1.8 0 0 1 3.2 14.5 z"
          fill={AWAITING_AMBER}
        />
        <Circle cx={8} cy={9.5} r={1.3} fill="#0e0f10" />
        <Circle cx={12} cy={9.5} r={1.3} fill="#0e0f10" />
        <Circle cx={16} cy={9.5} r={1.3} fill="#0e0f10" />
      </Svg>
    </Animated.View>
  )
}

/**
 * Breathing opacity, or a steady 1 when nothing is in flight.
 *
 * useEffect exception: an imperative animation loop tied to a value, one
 * of the cases CLAUDE.md keeps the hook for. The loop has to be stopped
 * when the turn ends, hence the cleanup.
 */
function usePulse(active: boolean): Animated.Value {
  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!active) {
      pulse.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [active, pulse])
  return pulse
}
