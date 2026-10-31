import { onTabRemoved } from '@/modules/stores/$navigation'
import { $projects, removeTab } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { requestInterrupt } from '@/modules/work/$interrupt'
import { activeWorkForTab } from '@/modules/work/active-work'

/**
 * Everything a close does, in one place.
 *
 * `onTabRemoved` moves the active tab and dismisses the tab's pending
 * notification, so it belongs with the removal and not with the request.
 * Running it at the call site meant cancelling the confirmation left the
 * tab open but already navigated away from, with its notification gone.
 */
function closeTabNow(projectId: string, tabId: string): void {
  onTabRemoved(projectId, tabId)
  removeTab(projectId, tabId)
}

/**
 * Close a tab, asking first when something is running in it.
 *
 * Every close path goes through here rather than calling `removeTab`
 * directly, so the keyboard shortcut, the tab bar and the sidebar cannot
 * drift apart on whether they ask.
 */
export function requestCloseTab(projectId: string, tabId: string): void {
  const project = $projects.get().find((p) => p.id === projectId)
  if (!project) return
  if (!activeWorkForTab(project, tabId, $tabMeta.get())) {
    closeTabNow(projectId, tabId)
    return
  }
  requestInterrupt({ kind: 'close-tab', projectId, tabId })
}

/** Taken only once the user has confirmed the interruption. */
export function confirmCloseTab(projectId: string, tabId: string): void {
  closeTabNow(projectId, tabId)
}
