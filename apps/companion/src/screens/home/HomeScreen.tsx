import { Link } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useHomeData } from './home.data'

/**
 * How long we wait on ConnectingHome before showing the escape-hatch
 * "Stuck? Unpair" link. Shorter than autoConnect's worst-case ladder
 * timeout (~10 s across four rungs), so the user always sees the link
 * before the state naturally transitions to `unreachable`. If the
 * ladder resolves before this fires, the ConnectingHome unmounts and
 * the timer is cleared.
 */
const STUCK_CONNECTING_MS = 10_000

export function HomeScreen() {
  const data = useHomeData()
  switch (data.kind) {
    case 'unpaired':
      return <UnpairedHome />
    case 'connecting':
      return <ConnectingHome hint={data.hint} onUnpair={data.unpair} />
    case 'unreachable':
      return (
        <UnreachableHome
          hint={data.hint}
          lastError={data.session.lastError}
          onRetry={data.retry}
          onUnpair={data.unpair}
        />
      )
    case 'connected':
      return <PairedHome {...data} />
  }
}

function UnpairedHome() {
  return (
    <View className="bg-background flex-1 items-center justify-center gap-6 p-6">
      <View className="items-center gap-2">
        <Text className="text-foreground text-2xl font-semibold">
          Agent Terminal
        </Text>
        <Text className="text-muted-foreground text-center text-sm">
          Pair with a desktop to view and drive its tabs from here.
        </Text>
      </View>
      <View className="w-full gap-3">
        <Link href="/pair" asChild>
          <Pressable className="bg-accent items-center rounded-md px-6 py-3">
            <Text className="text-accent-foreground text-base font-semibold">
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
            <Pressable className="border-border items-center rounded-md border px-6 py-3">
              <Text className="text-foreground text-base">
                Use manual token (dev only)
              </Text>
            </Pressable>
          </Link>
        )}
      </View>
    </View>
  )
}

function ConnectingHome({
  hint,
  onUnpair,
}: {
  hint: string | null
  onUnpair: () => void
}) {
  const stuck = useStuckTimer(STUCK_CONNECTING_MS)
  return (
    <View className="bg-background flex-1 items-center justify-center gap-4 p-6">
      <ActivityIndicator size="large" />
      <Text className="text-foreground text-center text-lg font-semibold">
        Connecting to {hint ?? 'desktop'}…
      </Text>
      <Text className="text-muted-foreground text-center text-sm">
        Looking for the desktop on your local network.
      </Text>
      {stuck && (
        <Pressable onPress={onUnpair} hitSlop={12} className="mt-2">
          <Text className="text-muted-foreground text-center text-sm underline">
            Stuck? Unpair
          </Text>
        </Pressable>
      )}
    </View>
  )
}

/**
 * Emit `true` after `ms` milliseconds. Timer starts on mount, clears
 * on unmount. Used by ConnectingHome to reveal the escape-hatch
 * Unpair link only after the ladder has had a real chance to complete.
 *
 * useEffect is the right hook here: we're subscribing to a timer, an
 * external system that lives outside React's render cycle.
 */
function useStuckTimer(ms: number): boolean {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setStuck(true), ms)
    return () => clearTimeout(t)
  }, [ms])
  return stuck
}

function UnreachableHome({
  hint,
  lastError,
  onRetry,
  onUnpair,
}: {
  hint: string | null
  lastError: string | null
  onRetry: () => void
  onUnpair: () => void
}) {
  return (
    <View className="bg-background flex-1 items-center justify-center gap-4 p-6">
      <Text className="text-destructive text-center text-lg font-semibold">
        Can't reach {hint ?? 'desktop'}
      </Text>
      <Text className="text-muted-foreground text-center text-sm">
        {lastError ??
          'Check that the desktop app is running and both devices are on the same Wi-Fi.'}
      </Text>
      <Pressable
        onPress={onRetry}
        className="bg-accent items-center rounded-md px-6 py-3"
      >
        <Text className="text-accent-foreground text-base font-semibold">
          Retry
        </Text>
      </Pressable>
      <Pressable onPress={onUnpair} hitSlop={12} className="mt-2">
        <Text className="text-muted-foreground text-center text-sm underline">
          Unpair from desktop
        </Text>
      </Pressable>
    </View>
  )
}

type PairedHomeProps = ReturnType<typeof useHomeData>

function PairedHome({
  hint,
  projectCount,
  tabCount,
  disconnect,
}: PairedHomeProps) {
  return (
    <View className="bg-background flex-1 gap-6 p-6">
      <View className="gap-1">
        <Text className="text-muted-foreground text-xs tracking-wide uppercase">
          Connected to
        </Text>
        {/* The desktop's name, not this phone's. `session.deviceName` is
            the name the phone sent at pairing so the desktop could mint a
            token, which makes it the wrong end of the connection to show
            here. The connecting and unreachable states above already use
            `hint`; this is the one that did not. */}
        <Text className="text-foreground text-2xl font-semibold">
          {hint ?? 'your desktop'}
        </Text>
      </View>
      <View className="flex-row gap-3">
        <StatTile label="Projects" value={projectCount} />
        <StatTile label="Tabs" value={tabCount} />
      </View>
      <Link href="/switcher" asChild>
        <Pressable className="bg-accent items-center rounded-md px-4 py-3">
          <Text className="text-accent-foreground text-base font-semibold">
            Browse projects
          </Text>
        </Pressable>
      </Link>
      <Pressable
        onPress={disconnect}
        className="border-border bg-muted items-center rounded-md border px-4 py-3"
      >
        <Text className="text-foreground text-base">Disconnect</Text>
      </Pressable>
    </View>
  )
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <View className="border-border bg-card flex-1 rounded-md border p-4">
      <Text className="text-muted-foreground text-xs uppercase">{label}</Text>
      <Text className="text-foreground text-3xl font-semibold">{value}</Text>
    </View>
  )
}
