import { useStore } from '@nanostores/react'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { $session } from '@/modules/stores/$session'
import { StatusSheet } from '@/screens/status/StatusSheet'
import { composedTabId } from '@/screens/tab/tab.helpers'

export default function StatusRoute() {
  const session = useStore($session)
  const { projectId, tabId } = useLocalSearchParams<{
    projectId: string
    tabId: string
  }>()
  if (session.status !== 'connected') {
    return <Redirect href="/connect" />
  }
  return (
    <StatusSheet
      projectId={projectId}
      tabId={composedTabId(projectId, tabId)}
    />
  )
}
