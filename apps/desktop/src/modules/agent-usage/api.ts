import { invoke } from '@tauri-apps/api/core'
import type { AgentUsagePreferences, UsageSnapshot } from './types'

export const AgentUsageIPC = {
  snapshot: () => invoke<UsageSnapshot>('usage_snapshot'),
  refresh: () => invoke<void>('usage_refresh'),
  rescanAgents: () => invoke<void>('usage_rescan_agents'),
  authorizeClaudeKeychain: () =>
    invoke<void>('usage_authorize_claude_keychain'),
  setPreferences: (preferences: AgentUsagePreferences) =>
    invoke<UsageSnapshot>('usage_set_preferences', { preferences }),
}
