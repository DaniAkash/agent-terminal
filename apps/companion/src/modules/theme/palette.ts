/**
 * Companion color palette. Mirrors the CSS variables declared in
 * `global.css` (inside `@layer theme > :root > @variant light|dark`)
 * so React Navigation's header chrome shares the exact visual
 * language as the app body.
 *
 * Uniwind renders CSS `oklch()` values by resolving them through
 * sRGB and clamping out-of-gamut channels. The accent values here
 * are the hex output of that same conversion:
 *   oklch(0.55 0.18 225) -> #0082bf  (light accent)
 *   oklch(0.68 0.15 225) -> #00aadd  (dark accent)
 * Keeping them as literal hex avoids depending on any specific
 * runtime's oklch implementation.
 *
 * KEEP IN SYNC WITH `companion/global.css`. Any palette change here
 * needs a matching change to the corresponding CSS variable, and
 * vice versa.
 */

export interface Palette {
  background: string
  foreground: string
  card: string
  cardForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  accentSoft: string
  border: string
  input: string
  destructive: string
  success: string
}

export const lightPalette: Palette = {
  background: '#ffffff',
  foreground: 'rgba(20, 22, 25, 0.9)',
  card: '#ffffff',
  cardForeground: 'rgba(20, 22, 25, 0.9)',
  muted: 'rgba(0, 0, 0, 0.03)',
  mutedForeground: 'rgba(0, 0, 0, 0.55)',
  accent: '#0082bf',
  accentForeground: '#ffffff',
  accentSoft: 'rgba(0, 130, 191, 0.10)',
  border: 'rgba(0, 0, 0, 0.08)',
  input: 'rgba(0, 0, 0, 0.08)',
  destructive: '#c23648',
  success: '#2e8b3d',
}

export const darkPalette: Palette = {
  background: '#0e0f10',
  foreground: 'rgba(230, 232, 235, 0.92)',
  card: '#0e0f10',
  cardForeground: 'rgba(230, 232, 235, 0.92)',
  muted: 'rgba(255, 255, 255, 0.04)',
  mutedForeground: 'rgba(255, 255, 255, 0.55)',
  accent: '#00aadd',
  accentForeground: '#000000',
  accentSoft: 'rgba(0, 170, 221, 0.14)',
  border: 'rgba(255, 255, 255, 0.08)',
  input: 'rgba(255, 255, 255, 0.08)',
  destructive: '#f7768e',
  success: '#9ece6a',
}
