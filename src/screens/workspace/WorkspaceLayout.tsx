import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'
import { Sidebar } from '@/components/Sidebar/Sidebar'
import { StatusBar } from '@/components/StatusBar/StatusBar'
import { $projects } from '@/modules/stores/$projects'

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const projects = useStore($projects)
  const sessionsRunning = projects.reduce(
    (n, p) => n + p.tabs.filter((t) => t.running).length,
    0,
  )

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
      <StatusBar sessionsRunning={sessionsRunning} />
    </div>
  )
}
