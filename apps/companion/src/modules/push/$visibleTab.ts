import { atom } from 'nanostores'

/**
 * The composed tab id currently on screen, or null when no terminal is.
 *
 * Push is the only consumer: a banner over the very screen it is about
 * is noise. `$lastSession` cannot stand in for this, because it keeps
 * pointing at the last tab after the user navigates away, which would
 * swallow a banner the user should have seen.
 *
 * Written from the tab screen's focus lifecycle rather than during
 * render, because the blur half is what makes it honest.
 */
export const $visibleTab = atom<string | null>(null)

export function noteVisibleTab(composedTabId: string): void {
  $visibleTab.set(composedTabId)
}

export function clearVisibleTab(composedTabId: string): void {
  // Guarded so a late blur from a screen that has already been replaced
  // does not clear the tab that replaced it.
  if ($visibleTab.get() === composedTabId) $visibleTab.set(null)
}
