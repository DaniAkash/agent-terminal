import { Text, View } from 'react-native'

interface PlaceholderSheetProps {
  title: string
  body: string
}

/**
 * Stands in for a sheet whose surface has not been built yet. Exists so
 * the route tree is complete and navigable now, rather than being wired
 * up later against screens that were never reachable.
 */
export function PlaceholderSheet({ title, body }: PlaceholderSheetProps) {
  return (
    <View className="flex-1 gap-2 bg-background px-5 pt-5">
      <Text className="font-semibold text-foreground text-lg">{title}</Text>
      <Text className="text-muted-foreground text-sm">{body}</Text>
    </View>
  )
}
