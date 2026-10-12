import { useStore } from '@nanostores/react'
import { Redirect, Stack, useLocalSearchParams } from 'expo-router'
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

  if (terminalRouteAction(device) === 'pair') {
    return <Redirect href="/pair" />
  }

  const composed = composedTabId(projectId, tabId)
  // Remembered during render rather than in an effect: it is a plain
  // store write with no subscription or teardown, and doing it here means
  // a cold start that lands straight here still records the session.
  const deviceId = device.record?.deviceId
  if (deviceId) noteActiveSession(deviceId, composed)

  return (
    <>
      <Stack.Screen options={{ title: 'Terminal' }} />
      <TabScreen projectId={projectId} tabId={composed} />
    </>
  )
}
