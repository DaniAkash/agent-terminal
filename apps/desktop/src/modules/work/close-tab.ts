import { $projects, removeTab } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { requestInterrupt } from '@/modules/work/$interrupt'
import { activeWorkForTab } from '@/modules/work/active-work'

/**
 * Close a tab, asking first when something is running in it.
 *
 * Every close path routes through here rather than calling `removeTab`
 * directly, so the keyboard shortcut, the tab bar and the sidebar cannot
 * drift apart on whether they ask.
 */
export function requestCloseTab(projectId: string, tabId: string): void {
  const project = $projects.get().find((p) => p.id === projectId)
  if (!project) return
  if (!activeWorkForTab(project, tabId, $tabMeta.get())) {
    removeTab(projectId, tabId)
    return
  }
  requestInterrupt({ kind: 'close-tab', projectId, tabId })
}
