import type { WorkspaceGroup } from '@agent-terminal/core-ui'
import { Pressable, Text, View } from 'react-native'
import { Icon } from '@/components/ui/Icon'

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
  return (
    <View className="flex-row items-center gap-1 px-1 pt-3 pb-1">
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={headerLabel(group)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        className="flex-1 flex-row items-center gap-2 rounded-md py-1 active:opacity-60"
      >
        <View className="w-3 items-center">
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={13} />
        </View>
        <Text
          numberOfLines={1}
          className="flex-1 font-medium text-foreground text-xs uppercase"
        >
          {group.projectName}
        </Text>
        {group.pinned && <Icon name="pin" size={11} />}
      </Pressable>
      <Pressable
        onPress={onNewSession}
        accessibilityRole="button"
        accessibilityLabel={`New session in ${group.projectName}`}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        className="rounded-md px-2 py-1 active:opacity-60"
      >
        <Icon name="plus" size={16} />
      </Pressable>
    </View>
  )
}

/**
 * The header spoken in full, including the pin, which is drawn as an icon
 * and so reaches a screen reader no other way.
 */
function headerLabel(group: WorkspaceGroup): string {
  const count = group.sessions.length
  const plural = count === 1 ? '' : 's'
  const pin = group.pinned ? ', pinned' : ''
  return `${group.projectName}, ${count} session${plural}${pin}`
}
