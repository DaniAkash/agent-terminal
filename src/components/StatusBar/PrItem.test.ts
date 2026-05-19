import { describe, expect, test } from 'bun:test'
import {
  checksColor,
  stateColor,
  stateLabel,
  truncate,
} from '@/components/StatusBar/PrItem'
import type { PrInfo } from '@/modules/stores/$tabMeta'

/* ---------------------------------------------------------------------------
 * truncate
 * -------------------------------------------------------------------------*/

describe('truncate', () => {
  test('passes through strings shorter than the limit', () => {
    expect(truncate('hi', 10)).toBe('hi')
  })

  test('passes through strings exactly at the limit', () => {
    expect(truncate('hello', 5)).toBe('hello')
  })

  test('truncates and appends an ellipsis when over the limit', () => {
    expect(truncate('hello world', 8)).toBe('hello w…')
    expect(truncate('hello world', 8).length).toBe(8)
  })

  test('keeps the trailing character count exact (ellipsis counts as one)', () => {
    // 40-char cap is the real-world value; the cap is inclusive.
    const long = 'a'.repeat(80)
    const truncated = truncate(long, 40)
    expect(truncated.length).toBe(40)
    expect(truncated.endsWith('…')).toBe(true)
  })

  test('does not split surrogate pairs at the truncation boundary', () => {
    // 🚀 is U+1F680 — a single code point made of two UTF-16 code units.
    // Pre-fix: slicing by .length would cut between the high and low
    // surrogate and produce a stray replacement character before the
    // ellipsis. Post-fix: code-point-based slicing keeps the emoji intact.
    const titleWithEmoji = `${'a'.repeat(5)}🚀${'b'.repeat(10)}`
    const truncated = truncate(titleWithEmoji, 7)
    // First 6 code points (5 'a's + 🚀) then ellipsis = 7 code points total.
    expect(truncated).toBe(`${'a'.repeat(5)}🚀…`)
    expect(Array.from(truncated).length).toBe(7)
    // Crucially: no replacement character (U+FFFD) introduced.
    expect(truncated.includes('�')).toBe(false)
  })

  test('short emoji-laden titles pass through unchanged', () => {
    expect(truncate('🚀🎉✨', 10)).toBe('🚀🎉✨')
  })
})

/* ---------------------------------------------------------------------------
 * stateLabel
 * -------------------------------------------------------------------------*/

function pr(overrides: Partial<PrInfo> = {}): PrInfo {
  return {
    number: 1,
    title: 't',
    state: 'OPEN',
    isDraft: false,
    url: 'https://example.com/pr/1',
    ...overrides,
  }
}

describe('stateLabel', () => {
  test('open non-draft reads as "open"', () => {
    expect(stateLabel(pr())).toBe('open')
  })

  test('open + isDraft reads as "draft"', () => {
    expect(stateLabel(pr({ isDraft: true }))).toBe('draft')
  })

  test('merged overrides isDraft', () => {
    // Defence in depth — if backend ever sends MERGED + isDraft (it
    // shouldn't, but…), we want the user-visible label to reflect the
    // terminal state, not a stale draft flag.
    expect(stateLabel(pr({ state: 'MERGED', isDraft: true }))).toBe('merged')
  })

  test('closed reads as "closed"', () => {
    expect(stateLabel(pr({ state: 'CLOSED' }))).toBe('closed')
  })
})

/* ---------------------------------------------------------------------------
 * stateColor — maps to the github.com Primer palette for familiarity
 * -------------------------------------------------------------------------*/

describe('stateColor', () => {
  test('open non-draft → pr-open (green)', () => {
    expect(stateColor(pr())).toBe('var(--pr-open)')
  })

  test('open + isDraft → pr-draft (grey)', () => {
    expect(stateColor(pr({ isDraft: true }))).toBe('var(--pr-draft)')
  })

  test('merged → pr-merged (purple); wins over isDraft', () => {
    expect(stateColor(pr({ state: 'MERGED' }))).toBe('var(--pr-merged)')
    expect(stateColor(pr({ state: 'MERGED', isDraft: true }))).toBe(
      'var(--pr-merged)',
    )
  })

  test('closed → pr-closed (red); wins over isDraft', () => {
    expect(stateColor(pr({ state: 'CLOSED' }))).toBe('var(--pr-closed)')
    expect(stateColor(pr({ state: 'CLOSED', isDraft: true }))).toBe(
      'var(--pr-closed)',
    )
  })
})

/* ---------------------------------------------------------------------------
 * checksColor
 * -------------------------------------------------------------------------*/

describe('checksColor', () => {
  test("returns null when checks are undefined (CI hasn't reported yet)", () => {
    expect(checksColor(undefined)).toBeNull()
  })

  test('returns null when total is zero (no CI configured)', () => {
    expect(
      checksColor({ passing: 0, failing: 0, pending: 0, skipped: 0, total: 0 }),
    ).toBeNull()
  })

  test('red when any check is failing', () => {
    // Failing dominates — even alongside passing + pending.
    expect(
      checksColor({ passing: 5, failing: 1, pending: 2, skipped: 0, total: 8 }),
    ).toBe('var(--terminal-red)')
  })

  test('yellow when none failing but some pending', () => {
    expect(
      checksColor({ passing: 3, failing: 0, pending: 2, skipped: 0, total: 5 }),
    ).toBe('var(--terminal-yellow)')
  })

  test('green when all passing', () => {
    expect(
      checksColor({ passing: 5, failing: 0, pending: 0, skipped: 0, total: 5 }),
    ).toBe('var(--terminal-green)')
  })

  test('green when all passing + skipped (skipped treated as success)', () => {
    // Skipped checks are intentional (matrix gating, path filters). Showing
    // red because half the matrix was filtered out would mislead.
    expect(
      checksColor({ passing: 2, failing: 0, pending: 0, skipped: 3, total: 5 }),
    ).toBe('var(--terminal-green)')
  })

  test('green when all skipped (no passes, no failures)', () => {
    // Edge case: every check filtered out by a path matcher. Read as
    // "nothing is broken" — green, not yellow.
    expect(
      checksColor({ passing: 0, failing: 0, pending: 0, skipped: 4, total: 4 }),
    ).toBe('var(--terminal-green)')
  })

  test('red precedence: 1 failing + 99 pending still red', () => {
    expect(
      checksColor({
        passing: 0,
        failing: 1,
        pending: 99,
        skipped: 0,
        total: 100,
      }),
    ).toBe('var(--terminal-red)')
  })
})
