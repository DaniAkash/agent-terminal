import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { TabBar } from '@/components/TabBar/TabBar'
import { TerminalPane } from '@/components/TerminalPane/TerminalPane'
import { $activeTabId } from '@/modules/stores/$navigation'
import type { Project } from '@/screens/workspace/workspace.types'

type Props = {
  project: Project
}

export function WorkspaceView({ project }: Props) {
  const activeTabsByProject = useStore($activeTabId)
  // No fallback to project.tabs[0] here — tab selection is driven by
  // initNavigation() / navigateToProject() so the store is always authoritative.
  const activeTabId = activeTabsByProject[project.id] ?? ''

  // Lazy mount: only create a TerminalPane when a tab is first visited.
  // Once mounted, the pane stays alive forever (CSS show/hide, not unmount).
  const [mounted, setMounted] = useState<Set<string>>(
    () => new Set(activeTabId ? [activeTabId] : []),
  )

  useEffect(() => {
    if (activeTabId) {
      setMounted((prev) => {
        if (prev.has(activeTabId)) return prev
        return new Set([...prev, activeTabId])
      })
    }
  }, [activeTabId])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabBar project={project} />
      <div className="relative min-h-0 flex-1 bg-terminal">
        {project.tabs.map((tab) => {
          if (!mounted.has(tab.id)) return null
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              className="absolute inset-0"
              // CSS show/hide: terminal instance stays mounted, preserving
              // ghostty-web canvas state, pty process, and scrollback history.
              style={{ display: isActive ? 'block' : 'none' }}
            >
              <TerminalPane
                projectId={project.id}
                tabId={tab.id}
                cwd={tab.lastCwd ?? project.path}
                isActive={isActive}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
