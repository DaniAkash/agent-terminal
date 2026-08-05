import { useStore } from '@nanostores/react'
import { Redirect } from 'expo-router'
import { $session } from '@/modules/stores/$session'
import { ProjectsScreen } from '@/screens/projects/ProjectsScreen'

export default function ProjectsRoute() {
  const session = useStore($session)
  if (session.status !== 'connected') {
    return <Redirect href="/connect" />
  }
  return <ProjectsScreen />
}
