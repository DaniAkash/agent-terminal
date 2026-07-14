import { Link } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useHomeData } from './home.data'

export function HomeScreen() {
  const data = useHomeData()
  return data.isPaired ? <PairedHome {...data} /> : <UnpairedHome />
}

function UnpairedHome() {
  return (
    <View className="flex-1 items-center justify-center gap-6 bg-background p-6">
      <View className="items-center gap-2">
        <Text className="font-semibold text-2xl text-foreground">
          Agent Terminal
        </Text>
        <Text className="text-center text-muted-foreground text-sm">
          Pair with a desktop to view and drive its tabs from here.
        </Text>
      </View>
      <View className="w-full gap-3">
        <Link href="/pair" asChild>
          <Pressable className="items-center rounded-md bg-accent px-6 py-3">
            <Text className="font-semibold text-accent-foreground text-base">
              Scan QR to pair
            </Text>
          </Pressable>
        </Link>
        {/* Manual token flow is a dev-only escape hatch for simulator
            runs where the camera + QR path is impractical. `__DEV__`
            is Metro's build-time constant: true in dev bundles,
            statically false in production so the branch dead-code-
            eliminates from the shipped bundle. */}
        {__DEV__ && (
          <Link href="/connect" asChild>
            <Pressable className="items-center rounded-md border border-border px-6 py-3">
              <Text className="text-base text-foreground">
                Use manual token (dev only)
              </Text>
            </Pressable>
          </Link>
        )}
      </View>
    </View>
  )
}

type PairedHomeProps = ReturnType<typeof useHomeData>

function PairedHome({
  session,
  projectCount,
  tabCount,
  disconnect,
}: PairedHomeProps) {
  return (
    <View className="flex-1 gap-6 bg-background p-6">
      <View className="gap-1">
        <Text className="text-muted-foreground text-xs uppercase tracking-wide">
          Connected to
        </Text>
        <Text className="font-semibold text-2xl text-foreground">
          {session.deviceName}
        </Text>
      </View>
      <View className="flex-row gap-3">
        <StatTile label="Projects" value={projectCount} />
        <StatTile label="Tabs" value={tabCount} />
      </View>
      <Link href="/projects" asChild>
        <Pressable className="items-center rounded-md bg-accent px-4 py-3">
          <Text className="font-semibold text-accent-foreground text-base">
            Browse projects
          </Text>
        </Pressable>
      </Link>
      <Pressable
        onPress={disconnect}
        className="items-center rounded-md border border-border bg-muted px-4 py-3"
      >
        <Text className="text-base text-foreground">Disconnect</Text>
      </Pressable>
    </View>
  )
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 rounded-md border border-border bg-card p-4">
      <Text className="text-muted-foreground text-xs uppercase">{label}</Text>
      <Text className="font-semibold text-3xl text-foreground">{value}</Text>
    </View>
  )
}
