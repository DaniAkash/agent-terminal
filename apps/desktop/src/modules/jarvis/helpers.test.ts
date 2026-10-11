import { describe, expect, test } from 'bun:test'
import {
  capturedLabel,
  mostConstrained,
  quotaRings,
  resetLabel,
} from './helpers'
import type { ProviderUsage, UsageSnapshot } from './types'

const provider = (id: string, used: number): ProviderUsage => ({
  id,
  name: id,
  status: 'available',
  detected: true,
  windows: [
    { id: 'session', label: 'Session', usedPercent: used, resetsAt: null },
  ],
  source: 'Synthetic source',
  updatedAt: 1000,
  attemptedAt: 1000,
  message: null,
})

function snapshot(providers: ProviderUsage[]): UsageSnapshot {
  return {
    revision: 1,
    preferences: {
      enabled: true,
      showTray: false,
      refreshSeconds: 300,
      providers: providers.map((p) => p.id),
    },
    providers,
    refreshing: false,
    traySupported: true,
    claudeKeychainSupported: false,
    trayError: null,
    settingsError: null,
  }
}

describe('Jarvis usage summaries', () => {
  test('maps weekly and hourly layers for Codex, Claude and OpenCode', () => {
    for (const [id, hourly, weekly] of [
      ['codex', 'session', 'weekly'],
      ['claude-code', 'five_hour', 'seven_day'],
      ['opencode', 'rolling', 'weekly'],
    ]) {
      const data = provider(id, 0)
      data.windows = [
        { id: hourly, label: '5 hours', usedPercent: 0, resetsAt: null },
        { id: weekly, label: 'Weekly', usedPercent: 42, resetsAt: null },
        { id: 'monthly', label: 'Monthly', usedPercent: 99, resetsAt: null },
      ]
      expect(quotaRings(data).hourly?.usedPercent).toBe(0)
      expect(quotaRings(data).weekly?.usedPercent).toBe(42)
    }
  })

  test('keeps missing rings unknown and does not map monthly limits to hourly', () => {
    const data = provider('codex', 20)
    data.windows[0].label = 'Monthly'
    expect(quotaRings(data).hourly).toBeUndefined()
    expect(quotaRings(data).weekly).toBeUndefined()
    data.windows = []
    expect(quotaRings(data)).toEqual({ weekly: undefined, hourly: undefined })
  })

  test('prefers account windows over model-specific weekly windows', () => {
    const data = provider('claude-code', 0)
    data.windows = [
      {
        id: 'seven_day_sonnet',
        label: 'Sonnet · Weekly',
        usedPercent: 99,
        resetsAt: null,
      },
      { id: 'seven_day', label: 'Weekly', usedPercent: 30, resetsAt: null },
    ]
    expect(quotaRings(data).weekly?.usedPercent).toBe(30)
  })
  test('selects the most constrained live window across providers', () => {
    const data = snapshot([provider('codex', 10), provider('claude-code', 89)])
    expect(mostConstrained(data, 1000)?.provider.id).toBe('claude-code')
  })

  test('excludes stale, expired, and unavailable readings', () => {
    const stale = { ...provider('codex', 95), status: 'stale' as const }
    const expired = provider('claude-code', 99)
    expired.windows = [
      { id: 'session', label: 'Session', usedPercent: 99, resetsAt: 999 },
    ]
    expect(mostConstrained(snapshot([stale, expired]), 1000)).toBeNull()
    expect(mostConstrained(null)).toBeNull()
    const paused = snapshot([provider('codex', 50)])
    paused.preferences.enabled = false
    expect(mostConstrained(paused)).toBeNull()
  })

  test('zero reported usage remains a real reading', () => {
    expect(
      mostConstrained(snapshot([provider('codex', 0)]), 1000)?.window
        .usedPercent,
    ).toBe(0)
    expect(mostConstrained(snapshot([]), 1000)).toBeNull()
  })

  test('distinguishes unknown resets from resets that have passed', () => {
    expect(resetLabel(null, 1000)).toBe('Reset not reported')
    expect(resetLabel(900, 1000)).toBe('Reset passed · refresh needed')
    expect(resetLabel(1001, 1000)).toBe('Resets in 1m')
    expect(resetLabel(8260, 1000)).toBe('Resets in 2h 1m')
    expect(resetLabel(91400, 1000)).toBe('Resets in 1d 1h')
  })

  test('shows the capture age without replacing it with a retry time', () => {
    expect(capturedLabel(null, 1000)).toBe('Not refreshed yet')
    expect(capturedLabel(950, 1000)).toBe('Captured just now')
    expect(capturedLabel(100, 1000)).toBe('Captured 15m ago')
  })
})
