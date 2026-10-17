import { invoke } from '@tauri-apps/api/core'
import type { JarvisPreferences, UsageSnapshot } from './types'

export const JarvisIPC = {
  snapshot: () => invoke<UsageSnapshot>('jarvis_snapshot'),
  refresh: () => invoke<void>('jarvis_refresh'),
  rescanAgents: () => invoke<void>('jarvis_rescan_agents'),
  openMain: (settings: boolean) =>
    invoke<void>('jarvis_open_main', { settings }),
  dismissTray: () => invoke<void>('jarvis_dismiss_tray'),
  authorizeClaudeKeychain: () =>
    invoke<void>('jarvis_authorize_claude_keychain'),
  setPreferences: (preferences: JarvisPreferences) =>
    invoke<UsageSnapshot>('jarvis_set_preferences', { preferences }),
}
