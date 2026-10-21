import { Pressable, Text, View } from 'react-native'
import type { DeviceGroup } from './switcher.helpers'
import { relativeAge } from './switcher.helpers'

interface DeviceGroupHeaderProps {
  group: DeviceGroup
  now: number
  /** Makes this the driven desktop; a no-op if it already is. */
  onPress: () => void
  /** Shows or hides this device's rows without switching the connection. */
  onToggleCollapsed: () => void
}

/**
 * One header per paired desktop. Two sibling pressables rather than one
 * nested in the other, same reasoning as `SwitcherRowItem`: a pressable
 * inside an accessible pressable gets absorbed into the parent's
 * accessibility element, which would make the collapse control
 * unreachable by screen reader.
 */
export function DeviceGroupHeader({
  group,
  now,
  onPress,
  onToggleCollapsed,
}: DeviceGroupHeaderProps) {
  const status = group.connected
    ? 'connected'
    : group.syncedAt === null
      ? 'never synced'
      : `synced ${relativeAge(group.syncedAt, now)} ago`

  return (
    <View className="mt-3 mb-1 flex-row items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2.5">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={
          group.connected
            ? `${group.deviceName}, connected`
            : `Connect to ${group.deviceName}`
        }
        className="flex-1 flex-row items-center gap-2"
      >
        <View
          className={`h-1.5 w-1.5 rounded-full ${
            group.connected ? 'bg-success' : 'bg-muted-foreground/40'
          }`}
        />
        <Text
          numberOfLines={1}
          className="flex-1 font-semibold text-foreground text-sm"
        >
          {group.deviceName}
        </Text>
        <Text className="text-muted-foreground text-xs">{status}</Text>
      </Pressable>
      <Pressable
        onPress={onToggleCollapsed}
        accessibilityRole="button"
        accessibilityLabel={`Toggle ${group.deviceName}'s sessions`}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      >
        <Text className="text-muted-foreground text-xs">⌄</Text>
      </Pressable>
    </View>
  )
}
