import { Pressable, Text, View } from 'react-native'
import { glyphDotClass, glyphLabel } from '@/screens/tab/tab-status.helpers'
import { type SwitcherRow as Row, relativeAge } from './switcher.helpers'

interface SwitcherRowProps {
  row: Row
  now: number
  isCurrent: boolean
  onPress: () => void
  onLongPress: () => void
  /** Same menu as the long press, reachable without knowing it exists. */
  onMenu: () => void
}

export function SwitcherRowItem({
  row,
  now,
  isCurrent,
  onPress,
  onLongPress,
  onMenu,
}: SwitcherRowProps) {
  const age = relativeAge(row.lastActiveAt, now)
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      // The options button nested inside this row is absorbed into the
      // row's own accessibility element, so the path to it is named here
      // rather than being reachable only by sight.
      accessibilityLabel={`${row.label}, ${glyphLabel(row.glyph)}, in ${row.projectName}${age ? `, ${age} ago` : ''}. Long press for options.`}
      className={`flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent-soft ${
        isCurrent ? 'bg-accent-soft' : ''
      }`}
    >
      <View className={`h-2 w-2 rounded-full ${glyphDotClass(row.glyph)}`} />
      <View className="flex-1">
        <Text numberOfLines={1} className="font-medium text-foreground text-sm">
          {row.label}
        </Text>
        <Text numberOfLines={1} className="text-muted-foreground text-xs">
          {row.projectName}
        </Text>
      </View>
      <Text className="text-muted-foreground text-xs tabular-nums">{age}</Text>
      {/* A visible way into the workspace and the session details. The long
          press reaches the same menu, but a gesture with no affordance is
          not an entry point: it cannot be found by looking. */}
      <Pressable
        onPress={onMenu}
        accessibilityRole="button"
        accessibilityLabel={`Options for ${row.label}`}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
        className="px-1 py-1 active:opacity-60"
      >
        <Text className="text-muted-foreground text-sm">⋮</Text>
      </Pressable>
    </Pressable>
  )
}
