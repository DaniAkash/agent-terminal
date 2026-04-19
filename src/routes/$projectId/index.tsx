import { createFileRoute, redirect } from '@tanstack/react-router'
import { $projects } from '@/modules/stores/$projects'

export const Route = createFileRoute('/$projectId/')({
  beforeLoad: ({ params }) => {
    const project = $projects.get().find((p) => p.id === params.projectId)
    const firstTab = project?.tabs[0]
    if (firstTab) {
      throw redirect({
        to: '/$projectId/$tabId',
        params: { projectId: params.projectId, tabId: firstTab.id },
      })
    }
  },
  component: () => null,
})
