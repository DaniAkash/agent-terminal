import { useStore } from '@nanostores/react'
import { Redirect } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { $activeDevice } from '@/modules/stores/$devices'
import { $lastSession } from '@/modules/stores/$lastSession'
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
  const session = useStore($session)
  const lastSessions = useStore($lastSession)
  const target = resolveLanding(landingInput(device, session, lastSessions))

  if (!target) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    )
  }
  return <Redirect href={target} />
}
