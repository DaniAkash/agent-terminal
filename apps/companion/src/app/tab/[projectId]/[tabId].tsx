import { useStore } from '@nanostores/react'
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'
import { clearVisibleTab, noteVisibleTab } from '@/modules/push'
import { $activeDevice } from '@/modules/stores/$devices'
import { noteActiveSession } from '@/modules/stores/$lastSession'
import { TabScreen } from '@/screens/tab/TabScreen'
import { composedTabId, terminalRouteAction } from '@/screens/tab/tab.helpers'

export default function TabRoute() {
  const device = useStore($activeDevice)
  const { projectId, tabId } = useLocalSearchParams<{
    projectId: string
    tabId: string
  }>()

  const composed = composedTabId(projectId, tabId)
  // Above the early return: a hook after a conditional return changes
  // hook order between renders.
  useVisibleTab(composed)

  if (terminalRouteAction(device) === 'pair') {
    return <Redirect href="/pair" />
  }

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
