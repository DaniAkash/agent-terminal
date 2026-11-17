import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export interface Action {
  label: string
  onPress: () => void
  /** `primary` is the filled button; the default for the first action. */
  kind?: 'primary' | 'secondary' | 'link'
  disabled?: boolean
}

/** Room a screen leaves at its bottom so its content can scroll clear of the bar. */
export const ACTION_BAR_SPACE = 150

/**
 * The actions of a full screen, floating at the bottom of the screen
 * where a thumb already is, the same place on every state screen. The
 * first action is the filled one unless it says otherwise.
 */
export function ActionBar({ actions }: { actions: readonly Action[] }) {
  const insets = useSafeAreaInsets()
  if (actions.length === 0) return null
  return (
    <View
      style={{ bottom: insets.bottom + 14 }}
      className="border-border bg-background absolute right-3.5 left-3.5 gap-2 rounded-2xl border p-2.5 shadow-lg"
    >
      {actions.map((action, i) => (
        <ActionButton
          key={action.label}
          action={action}
          kind={action.kind ?? (i === 0 ? 'primary' : 'secondary')}
        />
      ))}
    </View>
  )
}

function ActionButton({
  action,
  kind,
}: {
  action: Action
  kind: 'primary' | 'secondary' | 'link'
}) {
  if (kind === 'link') {
    return (
      <Pressable
        onPress={action.onPress}
        disabled={action.disabled}
        accessibilityRole="button"
        hitSlop={8}
        className="items-center py-1.5"
      >
        <Text className="text-muted-foreground text-sm underline">
          {action.label}
        </Text>
      </Pressable>
    )
  }
  const primary = kind === 'primary'
  return (
    <Pressable
      onPress={action.onPress}
      disabled={action.disabled}
      accessibilityRole="button"
      className={
        primary
          ? 'bg-accent items-center rounded-md px-4 py-3 active:opacity-80'
          : 'border-border active:bg-accent-soft items-center rounded-md border px-4 py-3'
      }
    >
      <Text
        className={
          primary
            ? 'text-accent-foreground text-base font-semibold'
            : 'text-foreground text-base'
        }
      >
        {action.label}
      </Text>
    </Pressable>
  )
}
