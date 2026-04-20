import { atom } from 'nanostores'
import { $projects } from '@/modules/stores/$projects'

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
}

/**
 * Called BEFORE the tab is removed from $projects.
 * If the removed tab is currently active for its project, selects the nearest
 * remaining tab (previous if possible, otherwise first remaining, otherwise '').
 */
export function onTabRemoved(projectId: string, removedTabId: string): void {
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
