import { createRootRoute, Outlet } from '@tanstack/react-router'
import { WorkspaceLayout } from '@/screens/workspace/WorkspaceLayout'

export const Route = createRootRoute({
  component: () => (
    <WorkspaceLayout>
      <Outlet />
    </WorkspaceLayout>
  ),
})
