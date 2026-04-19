import { createFileRoute, redirect } from '@tanstack/react-router'
import { $projects } from '@/modules/stores/$projects'
import { Terminal } from '@/screens/terminal/Terminal'

export const Route = createFileRoute('/$projectId/$tabId')({
  beforeLoad: ({ params }) => {
    const project = $projects.get().find((p) => p.id === params.projectId)
    if (!project?.tabs.find((t) => t.id === params.tabId)) {
      throw redirect({
        to: '/$projectId',
        params: { projectId: params.projectId },
      })
    }
  },
  component: Terminal,
})
