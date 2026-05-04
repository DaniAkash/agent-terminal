/**
 * Notification preferences — single global toggle for v1.
 *
 * Stored in localStorage so it survives reloads (per-installation, not synced).
 * The backend `NotificationService` also keeps an in-memory copy synced via
 * `notif_set_enabled` so suppression decisions don't need to ask the
 * frontend on every transition.
 *
 * Defaults to enabled.
 */

import { invoke } from '@tauri-apps/api/core'

const ENABLED_KEY = 'agent-terminal:notifications:enabled'

export function notificationsEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) !== 'false'
}

export function setNotificationsEnabled(value: boolean): void {
  localStorage.setItem(ENABLED_KEY, value ? 'true' : 'false')
  void invoke('notif_set_enabled', { enabled: value }).catch(() => {})
}

/** Called once at app boot to mirror the persisted toggle into the backend. */
export function syncNotificationsEnabledToBackend(): void {
  void invoke('notif_set_enabled', { enabled: notificationsEnabled() }).catch(
    () => {},
  )
}
