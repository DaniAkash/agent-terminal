import { useEffect, useRef } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import {
  glyphDotClass,
  glyphLabel,
  glyphPulses,
  type TabGlyph,
} from './tab-status.helpers'

interface ActiveTabBarProps {
  label: string
  projectName: string
  glyph: TabGlyph
  /** False while the socket is down, which outranks whatever the agent was
   *  last seen doing: a lit green dot over a dead connection is a lie. */
  connected: boolean
  onPress: () => void
}

/**
 * The one piece of permanent chrome above the terminal: which session you
 * are in and what it is doing, the same two facts the desktop tab chip
 * shows. Kept to a single short row because every point it takes is a
 * point of scrollback the terminal does not get.
 *
 * The whole row is the switcher affordance, so reaching the session list
 * never costs a precise tap on a small control.
 */
export function ActiveTabBar({
  label,
  projectName,
  glyph,
  connected,
  onPress,
}: ActiveTabBarProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${connected ? glyphLabel(glyph) : 'offline'}, in ${projectName}. Opens the session list.`}
      className="flex-row items-center gap-2 border-border border-b bg-muted px-4 py-1.5 active:bg-accent-soft"
    >
      <StatusDot glyph={glyph} connected={connected} />
      <Text numberOfLines={1} className="font-medium text-foreground text-xs">
        {label}
      </Text>
      <Text numberOfLines={1} className="flex-1 text-muted-foreground text-xs">
        {projectName}
      </Text>
      <Text className="text-muted-foreground text-xs">⌃</Text>
    </Pressable>
  )
}

function StatusDot({
  glyph,
  connected,
}: {
  glyph: TabGlyph
  connected: boolean
}) {
  const pulse = useRef(new Animated.Value(1)).current
  // An agent state read off the last tree says nothing about now once the
  // socket is down, so the dot reports the connection instead.
  const pulses = connected && glyphPulses(glyph)

  // useEffect exception: drives an imperative animation loop tied to a
  // value, which is one of the cases CLAUDE.md keeps the hook for. The
  // loop must also be stopped when the turn ends, hence the cleanup.
  useEffect(() => {
    if (!pulses) {
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
  }, [pulses, pulse])

  return (
    <Animated.View style={{ opacity: pulse }}>
      <View
        className={`h-2 w-2 rounded-full ${
          connected ? glyphDotClass(glyph) : 'bg-destructive'
        }`}
      />
    </Animated.View>
  )
}
