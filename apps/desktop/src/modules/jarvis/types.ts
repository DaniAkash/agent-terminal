/** Mirrors the Rust usage DTOs. Secrets and account identifiers stay in Rust. */
export type UsageStatus =
  | 'disabled'
  | 'pending'
  | 'available'
  | 'not_configured'
  | 'unsupported'
  | 'stale'
  | 'error'

export interface UsageWindow {
  id: string
  label: string
  usedPercent: number
  resetsAt: number | null
}

export interface ProviderUsage {
  id: string
  name: string
  status: UsageStatus
  detected: boolean | null
  windows: UsageWindow[]
  source: string | null
  updatedAt: number | null
  attemptedAt: number | null
  message: string | null
}

export interface JarvisPreferences {
  enabled: boolean
  showTray: boolean
  refreshSeconds: number
  providers: string[]
}

export interface UsageSnapshot {
  revision: number
  preferences: JarvisPreferences
  providers: ProviderUsage[]
  refreshing: boolean
  traySupported: boolean
  claudeKeychainSupported: boolean
  trayError: string | null
  settingsError: string | null
}
