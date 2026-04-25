import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Sidebar } from '@/components/Sidebar/Sidebar'
import { StatusBar } from '@/components/StatusBar/StatusBar'
import { $ctrlHeld } from '@/modules/stores/$keyboard'
import {
  $activeProjectId,
  $activeTabId,
  navigateToProject,
  navigateToTab,
  onTabRemoved,
} from '@/modules/stores/$navigation'
import { $projects, addTab, removeTab } from '@/modules/stores/$projects'
import { WorkspaceView } from '@/screens/workspace/WorkspaceView'

/* ---------------------------------------------------------------------------
 * WorkspaceLayout
 * -------------------------------------------------------------------------*/

export function WorkspaceLayout() {
  const projects = useStore($projects)
  const activeProjectId = useStore($activeProjectId)

  // Lazy-mount projects: only render WorkspaceView once a project becomes active.
  // Already-mounted projects stay rendered and are CSS-hidden when inactive.
  const [mountedProjects, setMountedProjects] = useState<Set<string>>(
    () => new Set(activeProjectId ? [activeProjectId] : []),
  )

  useEffect(() => {
    if (activeProjectId) {
      setMountedProjects((prev) => {
        if (prev.has(activeProjectId)) return prev
        return new Set([...prev, activeProjectId])
      })
    }
  }, [activeProjectId])

  // Recovery: if the active project was removed, fall back to the first remaining one.
  useEffect(() => {
    const exists = projects.some((p) => p.id === activeProjectId)
    if (!exists && projects.length > 0) {
      navigateToProject(projects[0].id)
    }
  }, [projects, activeProjectId])

  // Track whether Ctrl is physically held so the sidebar can show project-number
  // badges. The blur listener resets the flag if the window loses focus while
  // Ctrl is held — prevents the overlay from getting stuck.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Control') $ctrlHeld.set(true)
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Control') $ctrlHeld.set(false)
    }
    function onBlur() {
      $ctrlHeld.set(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // enableOnFormTags is required because xterm uses a hidden <textarea> to
  // capture keyboard input. Without it react-hotkeys-hook silently ignores
  // all key events while the terminal has focus.
  const hotkeyOpts = { preventDefault: true, enableOnFormTags: true } as const

  // Ctrl+T — new tab in the active project
  useHotkeys(
    'ctrl+t',
    () => {
      const projectId = $activeProjectId.get()
      const newTab = addTab(projectId)
      if (newTab) navigateToTab(projectId, newTab.id)
    },
    hotkeyOpts,
  )

  // Ctrl+W — close the active tab (pinned tabs are protected)
  useHotkeys(
    'ctrl+w',
    () => {
      const projectId = $activeProjectId.get()
      const tabId = $activeTabId.get()[projectId] ?? ''
      if (!tabId) return
      const project = $projects.get().find((p) => p.id === projectId)
      const tab = project?.tabs.find((t) => t.id === tabId)
      if (tab?.pinned) return
      onTabRemoved(projectId, tabId)
      removeTab(projectId, tabId)
    },
    hotkeyOpts,
  )

  // Ctrl+Tab — cycle to the next tab in the active project (wraps around)
  useHotkeys(
    'ctrl+tab',
    () => {
      const projectId = $activeProjectId.get()
      const project = $projects.get().find((p) => p.id === projectId)
      if (!project || project.tabs.length < 2) return
      const tabId = $activeTabId.get()[projectId]
      const idx = project.tabs.findIndex((t) => t.id === tabId)
      const next = project.tabs[(idx + 1) % project.tabs.length]
      if (next) navigateToTab(projectId, next.id)
    },
    hotkeyOpts,
  )

  // Ctrl+Shift+Tab — cycle to the previous tab in the active project (wraps around)
  useHotkeys(
    'ctrl+shift+tab',
    () => {
      const projectId = $activeProjectId.get()
      const project = $projects.get().find((p) => p.id === projectId)
      if (!project || project.tabs.length < 2) return
      const tabId = $activeTabId.get()[projectId]
      const idx = project.tabs.findIndex((t) => t.id === tabId)
      const prev =
        project.tabs[(idx - 1 + project.tabs.length) % project.tabs.length]
      if (prev) navigateToTab(projectId, prev.id)
    },
    hotkeyOpts,
  )

  // Ctrl+1–9 — switch to project N in sidebar display order (pinned first).
  // Projects beyond 9 have no shortcut.
  useHotkeys(
    [
      'ctrl+1',
      'ctrl+2',
      'ctrl+3',
      'ctrl+4',
      'ctrl+5',
      'ctrl+6',
      'ctrl+7',
      'ctrl+8',
      'ctrl+9',
    ],
    (e) => {
      const n = Number.parseInt(e.key, 10) - 1
      const allProjects = $projects.get()
      const ordered = [
        ...allProjects.filter((p) => p.pinned),
        ...allProjects.filter((p) => !p.pinned),
      ]
      const target = ordered[n]
      if (target) navigateToProject(target.id)
    },
    hotkeyOpts,
  )

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="relative min-w-0 flex-1">
          {projects.map((project) => {
            if (!mountedProjects.has(project.id)) return null
            return (
              <div
                key={project.id}
                className="absolute inset-0 flex flex-col"
                style={{
                  display: project.id === activeProjectId ? 'flex' : 'none',
                }}
              >
                <WorkspaceView project={project} />
              </div>
            )
          })}
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
