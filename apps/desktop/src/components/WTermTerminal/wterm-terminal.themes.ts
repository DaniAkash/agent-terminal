import type { TerminalThemeColors } from '@wterm/dom'

// Terminal palettes tuned for legible shell output on the pane backgrounds.
//
// Based on VS Code's terminal defaults, with prompt colors adjusted for
// contrast against the matching application backgrounds. ANSI black remains
// black because prompts also use it as text on colored backgrounds.
//
// wterm takes opaque integer RGB rather than hex strings, and `palette`
// must hold exactly 16 entries in ANSI order: black, red, green, yellow,
// blue, magenta, cyan, white, then the eight bright variants. An invalid
// value throws a RangeError at `setThemeColors`, so these are written as
// literals rather than parsed at runtime.

export const DARK_THEME: TerminalThemeColors = {
  background: 0x0e0f10,
  foreground: 0xcccccc,
  cursor: 0xaeafad,
  palette: [
    0x000000, 0xed6666, 0x0dbc79, 0xe5e510, 0x4b9af0, 0xe070e0, 0x11a8cd,
    0xe5e5e5, 0x808080, 0xf14c4c, 0x23d18b, 0xf5f543, 0x3b8eea, 0xd670d6,
    0x29b8db, 0xe5e5e5,
  ],
}

export const LIGHT_THEME: TerminalThemeColors = {
  background: 0xffffff,
  foreground: 0x333333,
  cursor: 0x333333,
  palette: [
    0x000000, 0xcd3131, 0x007a32, 0x777500, 0x0451a5, 0xbc05bc, 0x00718a,
    0x555555, 0x666666, 0xcd3131, 0x008000, 0x777500, 0x0451a5, 0xbc05bc,
    0x00718a, 0x595959,
  ],
}

/**
 * The palette for a resolved theme preference.
 *
 * `index.html` always writes a resolved value to `data-theme`, so that is
 * the source of truth; the media query is only a fallback for the case
 * where that inline script failed.
 */
export function terminalTheme(
  docTheme: string | null,
  prefersDark: boolean,
): TerminalThemeColors {
  const useDark =
    docTheme === 'dark' ? true : docTheme === 'light' ? false : prefersDark
  return useDark ? DARK_THEME : LIGHT_THEME
}

/** The OSC 10 and OSC 11 colours the core reports, as `#RRGGBB`. */
export function coreThemeHex(colors: TerminalThemeColors): {
  foregroundColor: string
  backgroundColor: string
} {
  const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`
  return {
    foregroundColor: hex(colors.foreground),
    backgroundColor: hex(colors.background),
  }
}
