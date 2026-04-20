import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { Sidebar } from '@/components/Sidebar/Sidebar'
import { StatusBar } from '@/components/StatusBar/StatusBar'
import {
  $activeProjectId,
  $activeTabId,
  navigateToTab,
  onTabRemoved,
} from '@/modules/stores/$navigation'
import { $projects, addTab, removeTab } from '@/modules/stores/$projects'
import { WorkspaceView } from '@/screens/workspace/WorkspaceView'
import type { Project } from '@/screens/workspace/workspace.types'

/* ---------------------------------------------------------------------------
 * Keyboard shortcut helpers — extracted to keep handler complexity low
 * -------------------------------------------------------------------------*/

function handleNewTab(projectId: string) {
  const newTab = addTab(projectId)
  if (newTab) navigateToTab(projectId, newTab.id)
}

function handleCloseTab(projectId: string, tabId: string) {
  onTabRemoved(projectId, tabId)
  removeTab(projectId, tabId)
}

function handleJumpToTab(project: Project, digit: string) {
  const tab = project.tabs[Number.parseInt(digit, 10) - 1]
  if (tab) navigateToTab(project.id, tab.id)
}

// Module-level handler reads from atoms directly — stable reference, empty deps.
function onKeyDown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey)) return
  const projectId = $activeProjectId.get()
  const project = $projects.get().find((p) => p.id === projectId)
  if (!project) return
  const tabId = $activeTabId.get()[projectId] ?? ''
  if (e.key === 't') {
    e.preventDefault()
    handleNewTab(projectId)
  } else if (e.key === 'w') {
    e.preventDefault()
    handleCloseTab(projectId, tabId)
  } else if (/^[1-9]$/.test(e.key)) {
    e.preventDefault()
    handleJumpToTab(project, e.key)
  }
}

/* ---------------------------------------------------------------------------
 * WorkspaceLayout
 * -------------------------------------------------------------------------*/

export function WorkspaceLayout() {
  const projects = useStore($projects)
  const activeProjectId = useStore($activeProjectId)

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {/* All projects rendered simultaneously — active one visible via CSS */}
        <div className="relative min-w-0 flex-1">
          {projects.map((project) => (
            <div
              key={project.id}
              className="absolute inset-0 flex flex-col"
              style={{
                display: project.id === activeProjectId ? 'flex' : 'none',
              }}
            >
              <WorkspaceView project={project} />
            </div>
          ))}
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
