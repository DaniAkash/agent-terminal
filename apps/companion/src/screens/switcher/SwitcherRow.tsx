import type { SessionNode } from '@agent-terminal/core-ui'
import { Pressable, Text, View } from 'react-native'
import { DangerBadge, SessionGlyph } from '@/screens/tab/SessionGlyph'
import { relativeAge, spokenAge } from './switcher.helpers'

interface SwitcherRowProps {
  node: SessionNode
  now: number
  /** False in the Workspaces view, where the header above already names it. */
  showProject: boolean
  /** False in the Workspaces view, where tree position matters, not age. */
  showAge: boolean
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
  node,
  now,
  showProject,
  showAge,
  onPress,
  onLongPress,
  onMenu,
}: SwitcherRowProps) {
  const age = showAge ? relativeAge(node.lastActiveAt, now) : ''
  const agent =
    node.visual.kind === 'agent'
      ? (node.visual.brand?.displayName ?? node.visual.agentId)
      : null

  return (
    <View
      className={`flex-row items-center rounded-lg ${
        node.isCurrent ? 'bg-accent-soft' : ''
      }`}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={label(node, agent, age)}
        className={`flex-1 flex-row items-center gap-3 rounded-lg pr-2 ${
          showProject ? 'py-3 pl-3' : 'py-2.5 pl-6'
        }`}
      >
        <View className="h-4 w-4 items-center justify-center">
          <SessionGlyph visual={node.visual} size={14} />
        </View>
        <View className="flex-1">
          <Text
            numberOfLines={1}
            className="font-medium text-foreground text-sm"
          >
            {node.label}
          </Text>
          {showProject && (
            <Text numberOfLines={1} className="text-muted-foreground text-xs">
              {node.projectName}
            </Text>
          )}
        </View>
        {node.pinned && !showProject && (
          <Text
            accessibilityLabel="pinned"
            className="text-[10px] text-muted-foreground"
          >
            ⚲
          </Text>
        )}
        {node.visual.showDanger && <DangerBadge />}
        {age !== '' && (
          <Text className="text-muted-foreground text-xs tabular-nums">
            {age}
          </Text>
        )}
      </Pressable>
      {/* A visible way into the workspace and the session details. The long
          press reaches the same menu, but a gesture with no affordance is
          not an entry point: it cannot be found by looking. */}
      <Pressable
        onPress={onMenu}
        accessibilityRole="button"
        accessibilityLabel={`Options for ${node.label}`}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
        className="rounded-lg py-3 pr-3 pl-1 active:opacity-60"
      >
        <Text className="text-muted-foreground text-sm">⋮</Text>
      </Pressable>
    </View>
  )
}

/** Everything the row shows, spoken, including what only a colour says. */
function label(node: SessionNode, agent: string | null, age: string): string {
  const who = agent ? `${agent}, ` : ''
  const danger = node.visual.showDanger ? ', all permissions enabled' : ''
  return `${node.label}, ${who}${node.visual.label}${danger}, in ${node.projectName}${spokenAge(age)}`
}
