import { useStore } from '@nanostores/react'
import { TerminalPane } from '@/components/TerminalPane/TerminalPane'
import { $projects } from '@/modules/stores/$projects'
import { Route } from '@/routes/$projectId/$tabId'

export function Terminal() {
  const { projectId, tabId } = Route.useParams()
  const projects = useStore($projects)
  const project = projects.find((p) => p.id === projectId)

  if (!project) return null

  return (
    <TerminalPane
      key={`${projectId}:${tabId}`}
      projectId={projectId}
      tabId={tabId}
      cwd={project.path}
    />
  )
}
