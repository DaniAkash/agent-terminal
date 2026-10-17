import type { ProviderUsage, UsageSnapshot, UsageStatus } from './types'

export function installationLabel(detected: boolean | null) {
  return detected === null ? 'Checking…' : detected ? 'Installed' : 'Not found'
}

export function quotaRings(provider: ProviderUsage) {
  const primary = (ids: string[], label: RegExp) =>
    provider.windows.find(
      (window) => ids.includes(window.id) && label.test(window.label),
    ) ??
    provider.windows
      .filter((window) => label.test(window.label))
      .sort((a, b) => b.usedPercent - a.usedPercent)[0]
  return {
    weekly: primary(['weekly', 'seven_day'], /weekly/i),
    hourly: primary(['session', 'five_hour', 'rolling'], /hours?|session/i),
  }
}

export function isCurrent(provider: ProviderUsage, now = Date.now() / 1000) {
  return (
    provider.status === 'available' &&
    !provider.windows.some((window) =>
      window.resetsAt === null ? false : window.resetsAt <= now,
    )
  )
}

export function mostConstrained(
  snapshot: UsageSnapshot | null,
  now = Date.now() / 1000,
  providerId?: string | null,
) {
  if (!snapshot?.preferences.enabled) return null
  const candidates = snapshot.providers
    .filter(
      (provider) =>
        (!providerId || provider.id === providerId) &&
        snapshot.preferences.providers.includes(provider.id) &&
        isCurrent(provider, now),
    )
    .flatMap((provider) =>
      provider.windows.map((window) => ({ provider, window })),
    )
  return candidates.reduce<(typeof candidates)[number] | null>(
    (best, candidate) =>
      !best || candidate.window.usedPercent > best.window.usedPercent
        ? candidate
        : best,
    null,
  )
}

export function prioritizeProvider(
  providers: ProviderUsage[],
  providerId?: string | null,
) {
  if (!providerId) return providers
  return [...providers].sort(
    (a, b) => Number(b.id === providerId) - Number(a.id === providerId),
  )
}

export function resetLabel(reset: number | null, now = Date.now() / 1000) {
  if (reset === null) return 'Reset not reported'
  const seconds = Math.ceil(reset - now)
  if (seconds <= 0) return 'Reset passed · refresh needed'
  if (seconds >= 86_400)
    return `Resets in ${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`
  if (seconds >= 3600)
    return `Resets in ${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `Resets in ${Math.ceil(seconds / 60)}m`
}

export function capturedLabel(time: number | null, now = Date.now() / 1000) {
  if (time === null) return 'Not refreshed yet'
  const seconds = Math.max(0, now - time)
  if (seconds < 60) return 'Captured just now'
  if (seconds < 3600) return `Captured ${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `Captured ${Math.floor(seconds / 3600)}h ago`
  return `Captured ${Math.floor(seconds / 86_400)}d ago`
}

export const STATUS_LABEL: Record<UsageStatus, string> = {
  available: 'Live',
  disabled: 'Off',
  pending: 'Waiting',
  not_configured: 'Needs sign-in',
  unsupported: 'Quota unavailable',
  stale: 'Last known',
  error: 'Unavailable',
}

export function usageColor(used: number) {
  if (used >= 90) return 'var(--terminal-red)'
  if (used >= 75) return 'var(--terminal-yellow)'
  return 'var(--terminal-green)'
}
