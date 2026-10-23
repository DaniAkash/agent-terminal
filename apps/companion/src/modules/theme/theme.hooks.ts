import { useColorScheme } from 'react-native'
import { darkPalette, lightPalette, type Palette } from './palette'

/**
 * The palette for the scheme the OS is currently in.
 *
 * Uniwind resolves `className` for React Native's own components, so
 * anything drawn by a third party (the icon font's `Text` subclass, a
 * canvas, an SVG tint) has to be handed a literal colour instead. This
 * is where those callers get one, so the palette stays the only place
 * that knows a hex value.
 */
export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? darkPalette : lightPalette
}
