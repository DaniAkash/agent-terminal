import type { TabVisual } from '@agent-terminal/core-ui'
import { Pressable, Text, View } from 'react-native'
import { agentName } from '@/screens/switcher/switcher.helpers'
import { DangerBadge } from './DangerBadge'
import { SessionGlyph } from './SessionGlyph'

interface ActiveTabBarProps {
  label: string
  projectName: string
  visual: TabVisual
  /** False while the socket is down, which outranks whatever the agent was
   *  last seen doing: a lit green dot over a dead connection is a lie. */
  connected: boolean
  onPress: () => void
}

/**
 * The one piece of permanent chrome above the terminal: which session you
 * are in and what it is doing, the same two facts the desktop tab chip
 * shows, and now the same icon for them. Kept to a single short row
 * because every point it takes is a point of scrollback the terminal does
 * not get.
 *
 * The whole row is the switcher affordance, so reaching the session list
 * never costs a precise tap on a small control.
 */
export function ActiveTabBar({
  label,
  projectName,
  visual,
  connected,
  onPress,
}: ActiveTabBarProps) {
  const agent = agentName(visual)

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel(
        label,
        projectName,
        visual,
        connected,
        agent,
      )}
      className="flex-row items-center gap-2 border-border border-b bg-muted px-4 py-1.5 active:bg-accent-soft"
    >
      <View className="h-4 w-4 items-center justify-center">
        <SessionGlyph visual={visual} size={14} connected={connected} />
      </View>
      <Text numberOfLines={1} className="font-medium text-foreground text-xs">
        {label}
      </Text>
      <Text numberOfLines={1} className="flex-1 text-muted-foreground text-xs">
        {projectName}
      </Text>
      {visual.showDanger && <DangerBadge />}
      <Text className="text-muted-foreground text-xs">⌃</Text>
    </Pressable>
  )
}

/**
 * Spoken form of everything the row shows, including the badges, which a
 * screen reader cannot get from an emoji or a coloured circle.
 */
function accessibilityLabel(
  label: string,
  projectName: string,
  visual: TabVisual,
  connected: boolean,
  agent: string | null,
): string {
  const state = connected ? visual.label : 'offline'
  const who = agent ? `${agent}, ` : ''
  const danger = visual.showDanger ? ', all permissions enabled' : ''
  return `${label}, ${who}${state}${danger}, in ${projectName}. Opens the session list.`
}
