import type { WorkspaceGroup } from '@agent-terminal/core-ui'
import { Pressable, Text, View } from 'react-native'

/**
 * A workspace row in the Workspaces view: fold control, name, and a way
 * to start a session in it, the same three things the sidebar's project
 * row carries.
 *
 * The desktop's 1-9 badge is deliberately not here. It labels the Cmd+N
 * shortcut, and a phone has no such shortcut, so the number would be a
 * digit that looks like it means something and does not.
 */
export function WorkspaceHeader({
  group,
  collapsed,
  onToggle,
  onNewSession,
}: {
  group: WorkspaceGroup
  collapsed: boolean
  onToggle: () => void
  onNewSession: () => void
}) {
  const count = group.sessions.length
  return (
    <View className="flex-row items-center gap-1 px-1 pt-3 pb-1">
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={`${group.projectName}, ${count} session${count === 1 ? '' : 's'}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        className="flex-1 flex-row items-center gap-2 rounded-md py-1 active:opacity-60"
      >
        <Text className="w-3 text-center text-muted-foreground text-xs">
          {collapsed ? '›' : '⌄'}
        </Text>
        <Text
          numberOfLines={1}
          className="flex-1 font-medium text-foreground text-xs uppercase"
        >
          {group.projectName}
        </Text>
        {group.pinned && (
          <Text
            accessibilityLabel="pinned"
            className="text-[10px] text-muted-foreground"
          >
            ⚲
          </Text>
        )}
      </Pressable>
      <Pressable
        onPress={onNewSession}
        accessibilityRole="button"
        accessibilityLabel={`New session in ${group.projectName}`}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        className="rounded-md px-2 py-1 active:opacity-60"
      >
        <Text className="text-base text-muted-foreground">+</Text>
      </Pressable>
    </View>
  )
}
