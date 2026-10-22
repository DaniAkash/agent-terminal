import type { SessionView } from '@agent-terminal/core-ui'
import { Pressable, Text, View } from 'react-native'

const OPTIONS: Array<{ value: SessionView; label: string }> = [
  { value: 'workspaces', label: 'Workspaces' },
  { value: 'recent', label: 'Recent' },
]

/**
 * Segmented Workspaces / Recent switch, the phone's copy of the
 * sidebar's `SidebarViewToggle`.
 *
 * Each button is self-labelled and carries its own `selected` state,
 * which is what a screen reader needs; a surrounding group role would
 * only repeat what the names already say.
 */
export function SwitcherViewToggle({
  view,
  onChange,
}: {
  view: SessionView
  onChange: (view: SessionView) => void
}) {
  return (
    <View className="flex-row gap-0.5 rounded-lg bg-muted p-0.5">
      {OPTIONS.map((opt) => {
        const active = view === opt.value
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`flex-1 items-center rounded-md px-3 py-1.5 ${
              active ? 'bg-background' : ''
            }`}
          >
            <Text
              className={`text-xs ${
                active ? 'font-medium text-foreground' : 'text-muted-foreground'
              }`}
            >
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
