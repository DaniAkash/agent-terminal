import { useStore } from '@nanostores/react'
import { Redirect } from 'expo-router'
import { $activeDevice } from '@/modules/stores/$devices'
import { $lastSession } from '@/modules/stores/$lastSession'
import { $session } from '@/modules/stores/$session'
import { landingInput, resolveLanding } from './resolver.helpers'

/**
 * Renders no UI. Picks where a cold start lands and redirects, so the app
 * reopens in the session you left instead of on a list.
 */
export function IndexResolver() {
  const device = useStore($activeDevice)
  const session = useStore($session)
  const lastSessions = useStore($lastSession)
  return (
    <Redirect
      href={resolveLanding(landingInput(device, session, lastSessions))}
    />
  )
}
