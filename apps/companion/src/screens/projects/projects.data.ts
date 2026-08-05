import { useStore } from '@nanostores/react'
import { $session } from '@/modules/stores/$session'

export function useProjectsData() {
  const session = useStore($session)
  return { projects: session.projects }
}
