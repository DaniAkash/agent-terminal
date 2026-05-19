import { describe, expect, test } from 'bun:test'
import {
  filterSwitcherRows,
  formatRelativeTime,
  type SwitcherRow,
} from '@/components/TabSwitcher/tab-switcher.helpers'

/* ---------------------------------------------------------------------------
 * filterSwitcherRows
 * -------------------------------------------------------------------------*/

const sampleRows: SwitcherRow[] = [
  {
    tabKey: 'agent:dev',
    projectId: 'agent',
    projectName: 'agent-terminal',
    tabId: 'dev',
    label: 'dev',
    cwd: '/tmp/agent',
    rank: 1,
    lastActiveAt: 0,
    isCurrent: false,
  },
  {
    tabKey: 'cc:mem',
    projectId: 'cc',
    projectName: 'control-center',
    tabId: 'mem',
    label: 'memory note',
    rank: 2,
    lastActiveAt: 0,
    isCurrent: false,
  },
  {
    tabKey: 'agent:srv',
    projectId: 'agent',
    projectName: 'agent-terminal',
    tabId: 'srv',
    label: 'server',
    cwd: '/srv',
    rank: 3,
    lastActiveAt: 0,
    isCurrent: false,
  },
]

describe('filterSwitcherRows', () => {
  test('empty query returns the input array reference', () => {
    expect(filterSwitcherRows(sampleRows, '')).toBe(sampleRows)
    expect(filterSwitcherRows(sampleRows, '   ')).toBe(sampleRows)
  })

  test('substring match on label', () => {
    const out = filterSwitcherRows(sampleRows, 'mem')
    expect(out.map((r) => r.tabKey)).toEqual(['cc:mem'])
  })

  test('substring match on project name', () => {
    const out = filterSwitcherRows(sampleRows, 'agent')
    expect(out.map((r) => r.tabKey)).toEqual(['agent:dev', 'agent:srv'])
  })

  test('substring match on cwd', () => {
    const out = filterSwitcherRows(sampleRows, '/srv')
    expect(out.map((r) => r.tabKey)).toEqual(['agent:srv'])
  })

  test('case-insensitive', () => {
    const out = filterSwitcherRows(sampleRows, 'MeMoRy')
    expect(out.map((r) => r.tabKey)).toEqual(['cc:mem'])
  })

  test('preserves the input order among matches (= recency)', () => {
    const out = filterSwitcherRows(sampleRows, 'agent')
    // Order in `sampleRows`: dev then srv. Filter preserves that, so
    // rank 1 still leads rank 3 even after filter.
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
