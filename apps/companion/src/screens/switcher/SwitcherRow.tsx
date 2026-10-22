import type { SessionNode } from '@agent-terminal/core-ui'
import { Pressable, Text, View } from 'react-native'
import { DangerBadge } from '@/screens/tab/DangerBadge'
import { SessionGlyph } from '@/screens/tab/SessionGlyph'
import { relativeAge, rowSpokenLabel } from './switcher.helpers'
import type { RowVariant } from './switcher.list'

interface SwitcherRowProps {
  node: SessionNode
  now: number
  variant: RowVariant
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
  variant,
  onPress,
  onLongPress,
  onMenu,
}: SwitcherRowProps) {
  const standalone = variant === 'recent'
  const age = standalone ? relativeAge(node.lastActiveAt, now) : ''

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
        accessibilityLabel={rowSpokenLabel(node, age)}
        className={`flex-1 flex-row items-center gap-3 rounded-lg pr-2 ${
          standalone ? 'py-3 pl-3' : 'py-2.5 pl-6'
        }`}
      >
        <RowBody node={node} standalone={standalone} age={age} />
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

/** Glyph, name, and the trailing badges. */
function RowBody({
  node,
  standalone,
  age,
}: {
  node: SessionNode
  standalone: boolean
  age: string
}) {
  return (
    <>
      <View className="h-4 w-4 items-center justify-center">
        <SessionGlyph visual={node.visual} size={14} />
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} className="font-medium text-foreground text-sm">
          {node.label}
        </Text>
        {standalone && (
          <Text numberOfLines={1} className="text-muted-foreground text-xs">
            {node.projectName}
          </Text>
        )}
      </View>
      <RowTrailing
        pinned={node.pinned && !standalone}
        danger={node.visual.showDanger}
        age={age}
      />
    </>
  )
}

/**
 * The badges and age that sit at the end of a row.
 *
 * The pin only shows in the Workspaces view: in Recent the order is
 * recency, so a pin there would describe a rule that view does not use.
 */
function RowTrailing({
  pinned,
  danger,
  age,
}: {
  pinned: boolean
  danger: boolean
  age: string
}) {
  return (
    <>
      {pinned && (
        <Text
          accessibilityLabel="pinned"
          className="text-[10px] text-muted-foreground"
        >
          ⚲
        </Text>
      )}
      {danger && <DangerBadge />}
      {age !== '' && (
        <Text className="text-muted-foreground text-xs tabular-nums">
          {age}
        </Text>
      )}
    </>
  )
}
