import { useStore } from '@nanostores/react'
import type { NavigateFn } from '@tanstack/react-router'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { Sidebar } from '@/components/Sidebar/Sidebar'
import { StatusBar } from '@/components/StatusBar/StatusBar'
import { IPC } from '@/modules/ipc/commands'
import { $projects, addTab, removeTab } from '@/modules/stores/$projects'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'

/* ---------------------------------------------------------------------------
 * Keyboard shortcut handlers — extracted to keep cognitive complexity low
 * -------------------------------------------------------------------------*/

function handleNewTab(projectId: string, navigate: NavigateFn) {
  const newTab = addTab(projectId)
  if (newTab) {
    navigate({
      to: '/$projectId/$tabId',
      params: { projectId, tabId: newTab.id },
    })
  }
}

function handleCloseTab(
  projectId: string,
  tabId: string,
  navigate: NavigateFn,
) {
  IPC.closeTab(makeTabKey(projectId, tabId)).catch(() => {})
  const project = $projects.get().find((p) => p.id === projectId)
  if (!project) return
  removeTab(projectId, tabId)
  const remaining = project.tabs.filter((t) => t.id !== tabId)
  const idx = project.tabs.findIndex((t) => t.id === tabId)
  const next = remaining[Math.max(0, idx - 1)] ?? remaining[0]
  if (next) {
    navigate({
      to: '/$projectId/$tabId',
      params: { projectId, tabId: next.id },
    })
  }
}

function handleJumpToTab(
  projectId: string,
  digit: string,
  navigate: NavigateFn,
) {
  const project = $projects.get().find((p) => p.id === projectId)
  const tab = project?.tabs[Number.parseInt(digit, 10) - 1]
  if (tab) {
    navigate({
      to: '/$projectId/$tabId',
      params: { projectId, tabId: tab.id },
    })
  }
}

/* ---------------------------------------------------------------------------
 * WorkspaceLayout
 * -------------------------------------------------------------------------*/

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const projects = useStore($projects)
  const navigate = useNavigate()
  const { projectId, tabId } = useParams({ strict: false }) as {
    projectId?: string
    tabId?: string
  }

  const sessionsRunning = projects.reduce(
    (n, p) => n + p.tabs.filter((t) => t.running).length,
    0,
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !projectId) return

      if (e.key === 't') {
        e.preventDefault()
        handleNewTab(projectId, navigate)
      } else if (e.key === 'w' && tabId) {
        e.preventDefault()
        handleCloseTab(projectId, tabId, navigate)
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        handleJumpToTab(projectId, e.key, navigate)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projectId, tabId, navigate])

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
