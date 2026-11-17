import { useStore } from '@nanostores/react'
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'
import { AppState } from 'react-native'
import { clearVisibleTab, noteVisibleTab } from '@/modules/push'
import { $activeDevice } from '@/modules/stores/$devices'
import { noteActiveSession } from '@/modules/stores/$lastSession'
import { $removal } from '@/modules/stores/$removal'
import { reclaimViewport } from '@/modules/wss/client'
import {
  shouldClaimOnFocus,
  toAppStateStatus,
} from '@/modules/wss/lifecycle.helpers'
import { TabScreen } from '@/screens/tab/TabScreen'
import { composedTabId, terminalRouteAction } from '@/screens/tab/tab.helpers'

export default function TabRoute() {
  const device = useStore($activeDevice)
  const removal = useStore($removal)
  const { projectId, tabId } = useLocalSearchParams<{
    projectId: string
    tabId: string
  }>()

  const composed = composedTabId(projectId, tabId)
  // Above the early return: a hook after a conditional return changes
  // hook order between renders.
  useVisibleTab(composed)
  useViewportClaim(composed)

  const action = terminalRouteAction(device, removal !== null)
  if (action !== 'render') return <Redirect href={`/${action}`} />

  // Remembered during render rather than in an effect: it is a plain
  // store write with no subscription or teardown, and doing it here means
  // a cold start that lands straight here still records the session.
  const deviceId = device.record?.deviceId
  if (deviceId) noteActiveSession(deviceId, composed)

  return <TabScreen projectId={projectId} tabId={composed} />
}

/**
 * Tell push which terminal is on screen, so a notification about this
 * very tab does not interrupt the user reading it.
 *
 * Focus rather than render: the blur half is what makes it honest.
 * `$lastSession` cannot stand in, because it keeps pointing here after
 * the user navigates away and would swallow a banner they should see.
 */
function useVisibleTab(composed: string): void {
  useFocusEffect(
    useCallback(() => {
      noteVisibleTab(composed)
      return () => clearVisibleTab(composed)
    }, [composed]),
  )
}

/**
 * Claim the terminal width for this phone while this session is the one
 * on screen.
 *
 * The desktop sizes the PTY for whichever surface declared last, so
 * looking at a session here has to say so or it arrives at the desktop's
 * column count, which on a phone is unreadable. Deliberately no blur
 * half: giving the width up on blur would reflow a full-screen agent
 * every time a window changed, and the desktop reclaims it by being
 * focused rather than by this screen going away.
 */
function useViewportClaim(composed: string): void {
  useFocusEffect(
    useCallback(() => {
      if (!shouldClaimOnFocus(toAppStateStatus(AppState.currentState))) return
      reclaimViewport(composed)
    }, [composed]),
  )
}
