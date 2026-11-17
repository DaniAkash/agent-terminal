import { useRouter } from 'expo-router'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { tabHref } from './tab.helpers'
import type { OtherTab } from './tab-info.helpers'

/**
 * Shown over the terminal when the desktop closes the tab it is showing:
 * the tab's name, that it was closed there, and the tabs that remain.
 * The old output stays readable behind it, dimmed, until the person
 * picks another tab; nothing here looks like a live terminal.
 */
export function ClosedTabSheet({
  label,
  remaining,
}: {
  label: string
  remaining: readonly OtherTab[]
}) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return (
    <View className="absolute inset-0 justify-end">
      <View className="absolute inset-0 bg-black/50" />
      <View
        style={{ paddingBottom: insets.bottom + 16, maxHeight: '70%' }}
        className="border-border bg-background gap-2 rounded-t-2xl border-t px-4 pt-4"
      >
        <Text className="text-foreground text-base font-semibold">
          {label} was closed on the desktop
        </Text>
        <Text className="text-muted-foreground text-sm">
          {remaining.length > 0
            ? 'Its output above is no longer live. Open another tab:'
            : 'Its output above is no longer live, and no other tab is open on the desktop.'}
        </Text>
        <ScrollView contentContainerStyle={{ gap: 6, paddingTop: 4 }}>
          {remaining.map((tab) => (
            <Pressable
              key={tab.tabId}
              onPress={() => router.replace(tabHref(tab.projectId, tab.tabId))}
              accessibilityRole="button"
              className="border-border bg-muted active:bg-accent-soft flex-row items-center justify-between gap-2 rounded-md border px-3 py-2.5"
            >
              <Text className="text-foreground font-mono text-sm">
                {tab.label}
              </Text>
              <Text className="text-muted-foreground text-xs">
                {tab.projectName}
              </Text>
            </Pressable>
          ))}
          {remaining.length === 0 && (
            <Pressable
              onPress={() => router.replace('/home')}
              accessibilityRole="button"
              className="bg-accent items-center rounded-md px-4 py-3"
            >
              <Text className="text-accent-foreground text-base font-semibold">
                Back to home
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </View>
  )
}
