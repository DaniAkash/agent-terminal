import { describe, expect, test } from 'bun:test'
import {
  DONE_LINGER_MS,
  doneExpiresAt,
  glyphDotClass,
  glyphLabel,
  glyphPulses,
  tabGlyph,
} from './tab-status.helpers'

const NOW = 1_000_000

describe('tabGlyph', () => {
  test('awaiting wins, because it is the state mobile exists to surface', () => {
    expect(tabGlyph('awaiting', NOW, NOW)).toBe('awaiting')
  })

  test('maps the states that do not expire', () => {
    expect(tabGlyph('running', NOW, NOW)).toBe('running')
    expect(tabGlyph('error', NOW, NOW)).toBe('error')
    expect(tabGlyph('idle', NOW, NOW)).toBe('idle')
  })

  test('an unknown or absent state reads as idle rather than throwing', () => {
    expect(tabGlyph(undefined, undefined, NOW)).toBe('idle')
    expect(tabGlyph('something-new', NOW, NOW)).toBe('idle')
  })

  test('done stays lit for the linger window', () => {
    expect(tabGlyph('done', NOW - 1, NOW)).toBe('done')
    expect(tabGlyph('done', NOW - (DONE_LINGER_MS - 1), NOW)).toBe('done')
  })

  test('done goes dim once the window has passed', () => {
    expect(tabGlyph('done', NOW - DONE_LINGER_MS, NOW)).toBe('idle')
    expect(tabGlyph('done', NOW - DONE_LINGER_MS * 10, NOW)).toBe('idle')
  })

  test('done with no stamp stays lit rather than guessing', () => {
    // A tree loaded from disk before the first sync looks like this.
    expect(tabGlyph('done', undefined, NOW)).toBe('done')
  })
})

describe('glyph presentation', () => {
  test('only a turn in flight pulses', () => {
    expect(glyphPulses('running')).toBe(true)
    for (const g of ['awaiting', 'done', 'error', 'idle'] as const) {
      expect(glyphPulses(g)).toBe(false)
    }
  })

  test('each state is visually distinguishable from idle', () => {
    const idle = glyphDotClass('idle')
    for (const g of ['awaiting', 'running', 'done', 'error'] as const) {
      expect(glyphDotClass(g)).not.toBe(idle)
    }
  })

  test('running and done share the colour, the pulse is what differs', () => {
    expect(glyphDotClass('running')).toBe(glyphDotClass('done'))
  })

  test('every state has a readable label', () => {
    for (const g of ['awaiting', 'running', 'done', 'error', 'idle'] as const) {
      expect(glyphLabel(g).length).toBeGreaterThan(0)
    }
  })
})

describe('doneExpiresAt', () => {
  test('arms one timer at the end of the linger window', () => {
    expect(doneExpiresAt('done', NOW)).toBe(NOW + DONE_LINGER_MS)
  })

  test('has nothing to expire for a state that does not fade', () => {
    for (const state of ['running', 'awaiting', 'error', 'idle', undefined]) {
      expect(doneExpiresAt(state, NOW)).toBeNull()
    }
  })

  test('has nothing to expire when done carries no stamp', () => {
    // Matches tabGlyph, which keeps an unstamped done lit rather than
    // guessing; with no stamp there is no moment to count from.
    expect(doneExpiresAt('done', undefined)).toBeNull()
  })
})
