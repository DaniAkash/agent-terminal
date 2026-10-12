import AsyncStorage from '@react-native-async-storage/async-storage'
import { atom } from 'nanostores'
import {
  isLastSessionMap,
  type LastSessionMap,
  rememberSession,
} from './$lastSession.helpers'

/**
 * Not in secure-store: a tab identifier is not a credential, and
 * secure-store's documented iOS size ceiling is better spent on the
 * device records themselves.
 */
const STORAGE_KEY = 'agent-terminal.last-session.v1'

export const $lastSession = atom<LastSessionMap>({})

export async function loadLastSessions(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (isLastSessionMap(parsed)) $lastSession.set(parsed)
  } catch {
    // A missing or corrupt map only costs the landing shortcut.
  }
}

/** Record the session being worked in. Fire-and-forget. */
export function noteActiveSession(deviceId: string, tabId: string): void {
  const next = rememberSession($lastSession.get(), deviceId, tabId)
  if (next === $lastSession.get()) return
  $lastSession.set(next)
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
}
