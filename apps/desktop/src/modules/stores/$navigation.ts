import { invoke } from '@tauri-apps/api/core'
import { atom } from 'nanostores'
import { $projects, addTab } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'
import type { Tab } from '@/screens/workspace/workspace.types'

/**
 * Best-effort: clear any pending OS notification for the navigated tab.
 * Navigating counts as acknowledgement. Failures are swallowed (the user
 * is doing something else important — notification cleanup is a side
 * effect, never the focus).
 *
 * Takes a project_id + tab_id pair (NOT a composite) and turns them into
 * the composite the backend keys notifications by.
 */
function dismissNotification(projectId: string, tabId: string): void {
  const composite = makeTabKey(projectId, tabId)
  invoke('notif_cancel', { tabId: composite }).catch(() => {
    /* ignored */
  })
}

// The currently active project ID.
export const $activeProjectId = atom<string>('')

// Per-project active tab. Maps projectId → tabId.
// Populated lazily: when a project becomes active, its first tab is selected
// if no tabId is recorded for it yet.
export const $activeTabId = atom<Record<string, string>>({})

/** Switch to a project. Selects the first tab if none is remembered for it. */
export function navigateToProject(projectId: string): void {
  $activeProjectId.set(projectId)
  const existing = $activeTabId.get()[projectId]
  if (!existing) {
    const project = $projects.get().find((p) => p.id === projectId)
    const firstTabId = project?.tabs[0]?.id
    if (firstTabId) {
      $activeTabId.set({ ...$activeTabId.get(), [projectId]: firstTabId })
    }
  }
}

/** Switch to a specific tab, also updating the active project. */
export function navigateToTab(projectId: string, tabId: string): void {
  $activeProjectId.set(projectId)
  $activeTabId.set({ ...$activeTabId.get(), [projectId]: tabId })
  dismissNotification(projectId, tabId)
}

/**
 * Called BEFORE the tab is removed from $projects.
 * If the removed tab is currently active for its project, selects the nearest
 * remaining tab (previous if possible, otherwise first remaining, otherwise '').
 */
export function onTabRemoved(projectId: string, removedTabId: string): void {
  // Closing a tab also dismisses any pending notification for it.
  dismissNotification(projectId, removedTabId)
  const project = $projects.get().find((p) => p.id === projectId)
  if (!project) return
  const current = $activeTabId.get()[projectId]
  if (current !== removedTabId) return
  const idx = project.tabs.findIndex((t) => t.id === removedTabId)
  const remaining = project.tabs.filter((t) => t.id !== removedTabId)
  const newActive =
    remaining[Math.max(0, idx - 1)]?.id ?? remaining[0]?.id ?? ''
  $activeTabId.set({ ...$activeTabId.get(), [projectId]: newActive })
}

/**
 * Open a fresh tab in `projectId`, inheriting cwd from a sensible source
 * tab in the same project, and switch to the new tab. Cwd is resolved as:
 *
 *   1. Live OSC 7 cwd from `$tabMeta` (this session's `cd`s)
 *   2. Persisted `Tab.lastCwd` (debounced into `$projects` last session)
 *   3. Otherwise `undefined` → caller falls through to `project.path`
 *
 * Source tab is `$activeTabId` for the project if set, otherwise
 * `project.tabs[0]` — covers the case where the user clicks a non-active
 * project's "+" button, in which case `$activeTabId` has no entry for
 * that project yet (it's lazy-populated on `navigateToProject`, and not
 * persisted across sessions).
 *
 * Why two cwd layers: `$tabMeta` only has entries for tabs whose PTYs
 * have spawned this session. For a project never visited in this session
 * but with persisted state from disk, `$tabMeta` is empty and we need to
 * fall back to the persisted `Tab.lastCwd`. `Tab.lastCwd` itself lags
 * live cwd by up to 2s (cwd-persist.ts debounce), which is why we prefer
 * `$tabMeta` first when both are available.
 */
export function openNewTabInProject(projectId: string): Tab | null {
  const project = $projects.get().find((p) => p.id === projectId)
  if (!project) return null
  // `?? project.tabs[0]` covers BOTH "no entry recorded" AND "recorded id no
  // longer exists in project.tabs" (stale state from a removal that didn't
  // route through onTabRemoved, persistence drift, etc.) — find() returning
  // undefined is treated identically to no entry.
  const activeTabId = $activeTabId.get()[projectId]
  const sourceTab =
    (activeTabId && project.tabs.find((t) => t.id === activeTabId)) ??
    project.tabs[0]
  const inheritCwd = sourceTab
    ? ($tabMeta.get()[makeTabKey(projectId, sourceTab.id)]?.cwd ??
      sourceTab.lastCwd)
    : undefined
  const newTab = addTab(projectId, inheritCwd || undefined)
  if (!newTab) return null
  navigateToProject(projectId)
  navigateToTab(projectId, newTab.id)
  return newTab
}

/** Initialize navigation from loaded projects (called on app start). */
export function initNavigation(): void {
  const projects = $projects.get()
  const first = projects[0]
  if (first) {
    const firstTabId = first.tabs[0]?.id ?? ''
    $activeProjectId.set(first.id)
    $activeTabId.set({ [first.id]: firstTabId })
  }
}
