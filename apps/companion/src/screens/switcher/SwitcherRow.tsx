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

/**
 * Two sibling pressables in a plain container rather than one nested in
 * the other: a pressable inside an accessible pressable is absorbed into
 * the parent's accessibility element, which leaves the options control
 * unreachable by screen reader however it is labelled.
 */
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
    <View
      className={`flex-row items-center rounded-lg ${
        isCurrent ? 'bg-accent-soft' : ''
      }`}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={`${row.label}, ${glyphLabel(row.glyph)}, in ${row.projectName}${age ? `, ${age} ago` : ''}`}
        className="flex-1 flex-row items-center gap-3 rounded-lg py-3 pr-2 pl-3 active:bg-accent-soft"
      >
        <View className={`h-2 w-2 rounded-full ${glyphDotClass(row.glyph)}`} />
        <View className="flex-1">
          <Text
            numberOfLines={1}
            className="font-medium text-foreground text-sm"
          >
            {row.label}
          </Text>
          <Text numberOfLines={1} className="text-muted-foreground text-xs">
            {row.projectName}
          </Text>
        </View>
        <Text className="text-muted-foreground text-xs tabular-nums">
          {age}
        </Text>
      </Pressable>
      {/* A visible way into the workspace and the session details. The long
          press reaches the same menu, but a gesture with no affordance is
          not an entry point: it cannot be found by looking. */}
      <Pressable
        onPress={onMenu}
        accessibilityRole="button"
        accessibilityLabel={`Options for ${row.label}`}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
        className="rounded-lg py-3 pr-3 pl-1 active:opacity-60"
      >
        <Text className="text-muted-foreground text-sm">⋮</Text>
      </Pressable>
    </View>
  )
}
