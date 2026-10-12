import { useStore } from '@nanostores/react'
import { Redirect, Stack, useLocalSearchParams } from 'expo-router'
import { $activeDevice } from '@/modules/stores/$devices'
import { noteActiveSession } from '@/modules/stores/$lastSession'
import { $session } from '@/modules/stores/$session'
import { composedTabId } from '@/screens/tab/tab.helpers'
import { TabScreen } from '@/screens/tab/TabScreen'

export default function TabRoute() {
  const session = useStore($session)
  const device = useStore($activeDevice)
  const { projectId, tabId } = useLocalSearchParams<{
    projectId: string
    tabId: string
  }>()

  if (session.status !== 'connected') {
    return <Redirect href="/connect" />
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
      <TabScreen tabId={composed} />
    </>
  )
}
