import {
  isSessionView,
  SESSION_VIEW_KEY,
  type SessionView,
} from '@agent-terminal/core-ui'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { atom } from 'nanostores'

/**
 * Which half of the session sheet is showing, mirroring the desktop's
 * `$sidebarView`.
 *
 * The key is shared with the desktop so the two apps at least agree on
 * what the setting is called; the storage is not, because React Native
 * has no `localStorage`. Writes are fire and forget: losing the
 * preference costs one tap, and blocking the toggle on a disk write
 * would be worse than that.
 */
export const $sessionView = atom<SessionView>('workspaces')

export async function loadSessionView(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(SESSION_VIEW_KEY)
    if (isSessionView(stored)) $sessionView.set(stored)
  } catch {
    // A preference that cannot be read is not worth a failure path.
  }
}

export function setSessionView(view: SessionView): void {
  $sessionView.set(view)
  AsyncStorage.setItem(SESSION_VIEW_KEY, view).catch(() => {})
}
