import { createFileRoute, redirect } from '@tanstack/react-router'
import { $projects } from '@/modules/stores/$projects'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const projects = $projects.get()
    const first = projects[0]
    if (first?.tabs[0]) {
      throw redirect({
        to: '/$projectId/$tabId',
        params: { projectId: first.id, tabId: first.tabs[0].id },
      })
    }
  },
  component: () => null,
})
