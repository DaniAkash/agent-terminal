import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { ActionBar } from '@/components/ui/ActionBar'
import { ConnectionStatus } from '@/components/ui/ConnectionStatus'
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
    case 'removed':
      return (
        <ConnectionStatus
          size="screen"
          actions={[
            { label: 'Scan to pair again', onPress: data.pairAgain },
            { label: 'Done', onPress: data.dismissRemoval },
          ]}
        />
      )
    case 'unpaired':
      return <UnpairedHome />
    case 'connecting':
      return <ConnectingHome onUnpair={data.unpair} />
    case 'unreachable':
      return (
        <ConnectionStatus
          size="screen"
          actions={[
            { label: 'Retry now', onPress: data.retry },
            { label: 'Unpair this desktop', onPress: data.unpair },
          ]}
        />
      )
    case 'connected':
      return <PairedHome {...data} />
  }
}

function UnpairedHome() {
  const router = useRouter()
  return (
    <View className="bg-background flex-1">
      <View className="flex-1 items-center justify-center gap-2 p-6 pb-40">
        <Text className="text-foreground text-2xl font-semibold">
          Agent Terminal
        </Text>
        <Text className="text-muted-foreground text-center text-sm">
          Pair with a desktop to view and drive its tabs from here.
        </Text>
      </View>
      {/* Manual token flow is a dev-only escape hatch for simulator runs
          where the camera + QR path is impractical. `__DEV__` is Metro's
          build-time constant: statically false in production, so the
          entry dead-code-eliminates from the shipped bundle. */}
      <ActionBar
        actions={[
          { label: 'Scan QR to pair', onPress: () => router.push('/pair') },
          ...(__DEV__
            ? [
                {
                  label: 'Use manual token (dev only)',
                  onPress: () => router.push('/connect'),
                },
              ]
            : []),
        ]}
      />
    </View>
  )
}

/**
 * Cold-start Connecting, the one full-screen connection state that is
 * not an ending. The escape hatch appears only once the ladder has had a
 * real chance.
 */
function ConnectingHome({ onUnpair }: { onUnpair: () => void }) {
  const stuck = useStuckTimer(STUCK_CONNECTING_MS)
  return (
    <ConnectionStatus
      size="screen"
      actions={
        stuck
          ? [{ label: 'Stuck? Unpair', onPress: onUnpair, kind: 'link' }]
          : []
      }
    />
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

type PairedHomeProps = ReturnType<typeof useHomeData>

function PairedHome({
  hint,
  projectCount,
  tabCount,
  disconnect,
}: PairedHomeProps) {
  const router = useRouter()
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
        <View className="mt-1 flex-row">
          <ConnectionStatus size="chip" />
        </View>
      </View>
      <View className="flex-row gap-3">
        <StatTile label="Projects" value={projectCount} />
        <StatTile label="Tabs" value={tabCount} />
      </View>
      <ActionBar
        actions={[
          { label: 'Browse projects', onPress: () => router.push('/switcher') },
          { label: 'Disconnect', onPress: disconnect },
        ]}
      />
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
