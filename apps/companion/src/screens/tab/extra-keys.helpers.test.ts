import { describe, expect, test } from 'bun:test'
import { applyAlt, applyCtrl, COMBOS, SEQ } from './extra-keys.helpers'

describe('SEQ', () => {
  test('arrow keys are the standard CSI sequences', () => {
    expect(SEQ.arrowUp).toBe('\x1b[A')
    expect(SEQ.arrowDown).toBe('\x1b[B')
    expect(SEQ.arrowRight).toBe('\x1b[C')
    expect(SEQ.arrowLeft).toBe('\x1b[D')
  })

  test('home / end use single-letter CSI variants', () => {
    expect(SEQ.home).toBe('\x1b[H')
    expect(SEQ.end).toBe('\x1b[F')
  })

  test('page up / down use tilde CSI variants', () => {
    expect(SEQ.pageUp).toBe('\x1b[5~')
    expect(SEQ.pageDown).toBe('\x1b[6~')
  })

  test('esc and tab match their standard single-byte forms', () => {
    expect(SEQ.esc).toBe('\x1b')
    expect(SEQ.tab).toBe('\t')
  })
})

describe('applyCtrl', () => {
  test('lowercase letters collapse to 0x01 through 0x1a', () => {
    expect(applyCtrl('a')).toBe('\x01')
    expect(applyCtrl('c')).toBe('\x03')
    expect(applyCtrl('l')).toBe('\x0c')
    expect(applyCtrl('z')).toBe('\x1a')
  })

  test('uppercase letters map to the same control code', () => {
    expect(applyCtrl('A')).toBe('\x01')
    expect(applyCtrl('C')).toBe('\x03')
    expect(applyCtrl('Z')).toBe('\x1a')
  })

  test('multi-char input passes through unchanged', () => {
    expect(applyCtrl('ab')).toBe('ab')
    expect(applyCtrl(SEQ.arrowUp)).toBe(SEQ.arrowUp)
  })

  test('single-char non-letters pass through unchanged', () => {
    expect(applyCtrl('/')).toBe('/')
    expect(applyCtrl('-')).toBe('-')
    expect(applyCtrl('1')).toBe('1')
    expect(applyCtrl('[')).toBe('[')
    expect(applyCtrl(SEQ.tab)).toBe(SEQ.tab)
  })
})

describe('applyAlt', () => {
  test('prepends ESC to a single-char input', () => {
    expect(applyAlt('a')).toBe('\x1ba')
    expect(applyAlt('.')).toBe('\x1b.')
  })

  test('works on multi-char input too (Alt+arrow etc.)', () => {
    expect(applyAlt(SEQ.arrowRight)).toBe('\x1b\x1b[C')
  })
})

describe('COMBOS', () => {
  test('each quick-combo matches applyCtrl on its own letter', () => {
    expect(COMBOS.ctrlC).toBe(applyCtrl('c'))
    expect(COMBOS.ctrlD).toBe(applyCtrl('d'))
    expect(COMBOS.ctrlZ).toBe(applyCtrl('z'))
    expect(COMBOS.ctrlL).toBe(applyCtrl('l'))
  })

  test('are the exact control bytes a terminal expects', () => {
    expect(COMBOS.ctrlC).toBe('\x03')
    expect(COMBOS.ctrlD).toBe('\x04')
    expect(COMBOS.ctrlZ).toBe('\x1a')
    expect(COMBOS.ctrlL).toBe('\x0c')
  })

  test('are single bytes, so an armed Ctrl/Alt on top passes them through', () => {
    // applyCtrl is a no-op on anything that is not a single a-z/A-Z char,
    // and these are already-collapsed control bytes — so tapping a combo
    // while Ctrl happens to be armed cannot double-encode it.
    for (const seq of Object.values(COMBOS)) {
      expect(applyCtrl(seq)).toBe(seq)
    }
  })
})
