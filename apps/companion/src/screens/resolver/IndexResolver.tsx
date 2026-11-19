import { useStore } from '@nanostores/react'
import { Redirect } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ConnectionStatus } from '@/components/ui/ConnectionStatus'
import { $push, takePendingRoute } from '@/modules/push'
import { handlePushData } from '@/modules/push/push.routing'
import { $activeDevice } from '@/modules/stores/$devices'
import { $lastSession } from '@/modules/stores/$lastSession'
import { $removal } from '@/modules/stores/$removal'
import { $session } from '@/modules/stores/$session'
import { landingInput, resolveLanding } from './resolver.helpers'

/**
 * Picks where a cold start lands, so the app reopens in the session you
 * left instead of on a list. Shows a spinner rather than redirecting
 * while the stores are still settling: deciding on the first render would
 * always land before the socket is up.
 */
export function IndexResolver() {
  const device = useStore($activeDevice)
  const push = useStore($push)
  const session = useStore($session)
  const lastSessions = useStore($lastSession)
  const removal = useStore($removal)

  // A notification tap that launched the app resolves before
  // SecureStore has hydrated the device store, so it was parked rather
  // than dropped. Replaying it outranks the remembered last session:
  // the user just asked for a specific terminal.
  if (device.loaded && push.pendingRoute) {
    replayPendingRoute()
    return <Spinner />
  }

  const target = resolveLanding(
    landingInput(device, session, lastSessions, removal !== null),
  )
  // A paired phone waiting for its desktop is in the Connecting state of
  // the design: say so, with the route it is trying, rather than spin.
  if (!target) return <Waiting paired={device.record !== null} />
  return <Redirect href={target} />
}

function replayPendingRoute(): void {
  const pending = takePendingRoute()
  if (pending) void handlePushData(pending)
}

function Waiting({ paired }: { paired: boolean }) {
  return paired ? <Connecting /> : <Spinner />
}

/** The full-screen Connecting state; this route has no header of its own. */
function Connecting() {
  const insets = useSafeAreaInsets()
  return (
    <View className="bg-background flex-1" style={{ paddingTop: insets.top }}>
      <ConnectionStatus size="screen" />
    </View>
  )
}

function Spinner() {
  return (
    <View className="bg-background flex-1 items-center justify-center">
      <ActivityIndicator />
    </View>
  )
}
