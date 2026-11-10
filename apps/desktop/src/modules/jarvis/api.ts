import { invoke } from '@tauri-apps/api/core'
import type { JarvisPreferences, UsageSnapshot } from './types'

export const JarvisIPC = {
  snapshot: () => invoke<UsageSnapshot>('usage_snapshot'),
  refresh: () => invoke<void>('usage_refresh'),
  rescanAgents: () => invoke<void>('usage_rescan_agents'),
  authorizeClaudeKeychain: () =>
    invoke<void>('usage_authorize_claude_keychain'),
  setPreferences: (preferences: JarvisPreferences) =>
    invoke<UsageSnapshot>('usage_set_preferences', { preferences }),
}
