import { Pressable, Text, View } from 'react-native'
import { glyphDotClass, glyphLabel } from '@/screens/tab/tab-status.helpers'
import { type SwitcherRow as Row, relativeAge } from './switcher.helpers'

interface SwitcherRowProps {
  row: Row
  now: number
  isCurrent: boolean
  onPress: () => void
  onLongPress: () => void
}

export function SwitcherRowItem({
  row,
  now,
  isCurrent,
  onPress,
  onLongPress,
}: SwitcherRowProps) {
  const age = relativeAge(row.lastActiveAt, now)
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${row.label}, ${glyphLabel(row.glyph)}, in ${row.projectName}${age ? `, ${age} ago` : ''}`}
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
    </Pressable>
  )
}
