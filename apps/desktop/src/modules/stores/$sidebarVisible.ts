import { atom } from 'nanostores'

/**
 * Whether the sidebar is currently visible.
 *
 * Persisted to localStorage so the choice survives restarts. Toggled by
 * the reveal button in the TabBar and by the global Cmd+B hotkey.
 *
 * Follows the persistence pattern established by `$theme`:
 *   - `initSidebarVisibleFromStorage()` at app boot to hydrate.
 *   - `setSidebarVisible()` / `toggleSidebarVisible()` write-through.
 */
const KEY = 'agent-terminal:sidebar-visible'

export const $sidebarVisible = atom<boolean>(true)

export function initSidebarVisibleFromStorage() {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'true' || v === 'false') {
      $sidebarVisible.set(v === 'true')
    }
  } catch {}
}

export function setSidebarVisible(visible: boolean) {
  try {
    localStorage.setItem(KEY, String(visible))
  } catch {}
  $sidebarVisible.set(visible)
}

export function toggleSidebarVisible() {
  setSidebarVisible(!$sidebarVisible.get())
}
