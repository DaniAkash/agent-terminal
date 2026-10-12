import { useStore } from '@nanostores/react'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { $session } from '@/modules/stores/$session'
import { WorkspaceEditSheet } from '@/screens/workspace-edit/WorkspaceEditSheet'

export default function WorkspaceEditRoute() {
  const session = useStore($session)
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  if (session.status !== 'connected') {
    return <Redirect href="/connect" />
  }
  return <WorkspaceEditSheet projectId={projectId} />
}
