import { atom } from 'nanostores'

/**
 * Which view the sidebar is currently showing.
 *
 * - `workspaces`, the current project → tabs tree (default, matches
 *   the pre-2026-07 sidebar).
 * - `recent`, a flat, recency-sorted list of every tab across every
 *   project. Reuses the Cmd+P data source so ordering is identical.
 *
 * Persisted to localStorage so the choice survives restarts.
 */
export type SidebarView = 'workspaces' | 'recent'

const KEY = 'agent-terminal:sidebar-view'

export const $sidebarView = atom<SidebarView>('workspaces')

export function initSidebarViewFromStorage() {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'workspaces' || v === 'recent') {
      $sidebarView.set(v)
    }
  } catch {}
}

export function setSidebarView(view: SidebarView) {
  try {
    localStorage.setItem(KEY, view)
  } catch {}
  $sidebarView.set(view)
}
