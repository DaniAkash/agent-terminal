import { useStore } from '@nanostores/react'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { $projects } from '@/modules/stores/$projects'

export const Route = createFileRoute('/$projectId')({
  beforeLoad: ({ params }) => {
    const project = $projects.get().find((p) => p.id === params.projectId)
    if (!project) throw redirect({ to: '/' })
  },
  component: ProjectLayout,
})

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const projects = useStore($projects)
  const project = projects.find((p) => p.id === projectId)

  if (!project) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Outlet />
    </div>
  )
}
