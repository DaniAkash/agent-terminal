import { describe, expect, test } from 'bun:test'
import { deriveTabVisual, type SessionRow } from '@agent-terminal/core-ui'
import {
  filterSwitcherRows,
  formatRelativeTime,
} from '@/components/TabSwitcher/tab-switcher.helpers'

/* ---------------------------------------------------------------------------
 * filterSwitcherRows
 * -------------------------------------------------------------------------*/

const NOW = 1_000_000_000_000

function row(over: Partial<SessionRow> & { key: string }): SessionRow {
  return {
    projectId: 'agent',
    projectName: 'agent-terminal',
    projectPinned: false,
    projectExpanded: true,
    tabId: over.key.split(':')[1] ?? 't',
    label: 'dev',
    pinned: false,
    isCurrent: false,
    rank: 1,
    visual: deriveTabVisual({ state: 'idle' }, NOW),
    ...over,
  }
}

const sampleRows: SessionRow[] = [
  row({ key: 'agent:dev', label: 'dev', rank: 1 }),
  row({ key: 'cc:mem', projectName: 'claude-memory', label: 'notes', rank: 2 }),
  row({ key: 'agent:srv', label: 'srv', rank: 3 }),
]

const CWD: Record<string, string> = {
  'agent:dev': '/tmp/agent',
  'cc:mem': '/tmp/cc',
  'agent:srv': '/srv/agent',
}

const cwdFor = (r: SessionRow) => CWD[r.key]

describe('filterSwitcherRows', () => {
  test('an empty query returns the same array, for memoisation', () => {
    expect(filterSwitcherRows(sampleRows, '   ', cwdFor)).toBe(sampleRows)
  })

  test('substring match on label', () => {
    const out = filterSwitcherRows(sampleRows, 'dev', cwdFor)
    expect(out.map((r) => r.key)).toEqual(['agent:dev'])
  })

  test('substring match on project name', () => {
    const out = filterSwitcherRows(sampleRows, 'agent-term', cwdFor)
    expect(out.map((r) => r.key)).toEqual(['agent:dev', 'agent:srv'])
  })

  test('substring match on cwd', () => {
    const out = filterSwitcherRows(sampleRows, '/srv', cwdFor)
    expect(out.map((r) => r.key)).toEqual(['agent:srv'])
  })

  test('case-insensitive', () => {
    const out = filterSwitcherRows(sampleRows, 'MeMoRy', cwdFor)
    expect(out.map((r) => r.key)).toEqual(['cc:mem'])
  })

  test('preserves the input order among matches, so recency survives', () => {
    const out = filterSwitcherRows(sampleRows, 'agent-term', cwdFor)
    expect(out.map((r) => r.rank)).toEqual([1, 3])
  })
})

/* ---------------------------------------------------------------------------
 * formatRelativeTime
 * -------------------------------------------------------------------------*/

describe('formatRelativeTime', () => {
  const now = 1_000_000_000_000

  test('undefined → never', () => {
    expect(formatRelativeTime(now, undefined)).toBe('never')
  })

  test('< 10s → just now', () => {
    expect(formatRelativeTime(now, now - 5_000)).toBe('just now')
    expect(formatRelativeTime(now, now)).toBe('just now')
  })

  test('< 60s → Ns ago', () => {
    expect(formatRelativeTime(now, now - 15_000)).toBe('15s ago')
    expect(formatRelativeTime(now, now - 59_000)).toBe('59s ago')
  })

  test('< 60min → Nm ago', () => {
    expect(formatRelativeTime(now, now - 60_000)).toBe('1m ago')
    expect(formatRelativeTime(now, now - 59 * 60_000)).toBe('59m ago')
  })

  test('< 24h → Nh ago', () => {
    expect(formatRelativeTime(now, now - 60 * 60_000)).toBe('1h ago')
    expect(formatRelativeTime(now, now - 23 * 60 * 60_000)).toBe('23h ago')
  })

  test('exactly 1 day → yesterday', () => {
    expect(formatRelativeTime(now, now - 24 * 60 * 60_000)).toBe('yesterday')
    expect(formatRelativeTime(now, now - 47 * 60 * 60_000)).toBe('yesterday')
  })

  test('2..6 days → Nd ago', () => {
    expect(formatRelativeTime(now, now - 48 * 60 * 60_000)).toBe('2d ago')
    expect(formatRelativeTime(now, now - 6 * 24 * 60 * 60_000)).toBe('6d ago')
  })

  test('7..29 days → Nw ago', () => {
    expect(formatRelativeTime(now, now - 7 * 24 * 60 * 60_000)).toBe('1w ago')
    expect(formatRelativeTime(now, now - 21 * 24 * 60 * 60_000)).toBe('3w ago')
  })

  test('>= 30 days → Nmo ago', () => {
    expect(formatRelativeTime(now, now - 30 * 24 * 60 * 60_000)).toBe('1mo ago')
    expect(formatRelativeTime(now, now - 120 * 24 * 60 * 60_000)).toBe(
      '4mo ago',
    )
  })

  test('negative diff (then > now) clamps to just now', () => {
    expect(formatRelativeTime(now, now + 5_000)).toBe('just now')
  })
})
