import { useStore } from '@nanostores/react'
import { Redirect, Stack, useLocalSearchParams } from 'expo-router'
import { $session } from '@/modules/stores/$session'
import { TabScreen } from '@/screens/tab/TabScreen'

export default function TabRoute() {
  const session = useStore($session)
  const { tabid } = useLocalSearchParams<{ tabid: string }>()
  if (session.status !== 'connected') {
    return <Redirect href="/connect" />
  }
  return (
    <>
      <Stack.Screen options={{ title: 'Terminal' }} />
      <TabScreen tabId={tabid} />
    </>
  )
}
