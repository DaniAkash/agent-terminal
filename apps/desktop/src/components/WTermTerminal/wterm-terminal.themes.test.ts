import { describe, expect, test } from 'bun:test'
import { DARK_THEME, LIGHT_THEME, terminalTheme } from './wterm-terminal.themes'

function luminance(color: number): number {
  const channels = [16, 8, 0].map((shift) => {
    const value = ((color >> shift) & 255) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

describe('terminal themes', () => {
  for (const [name, theme] of [
    ['dark', DARK_THEME],
    ['light', LIGHT_THEME],
  ] as const) {
    test(`${name} ANSI prompt colors are readable against the default background`, () => {
      const background = luminance(theme.background)
      // Dark-theme ANSI black is reserved for text on colored backgrounds.
      const colors = name === 'dark' ? theme.palette.slice(1) : theme.palette
      for (const color of colors) {
        const foreground = luminance(color)
        const contrast =
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        expect(contrast).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  test('explicit theme takes precedence over the system preference', () => {
    expect(terminalTheme('light', true)).toBe(LIGHT_THEME)
    expect(terminalTheme('dark', false)).toBe(DARK_THEME)
  })

  test('ANSI black remains black for text on colored prompt segments', () => {
    expect(DARK_THEME.palette[0]).toBe(0)
    expect(LIGHT_THEME.palette[0]).toBe(0)
  })
})
