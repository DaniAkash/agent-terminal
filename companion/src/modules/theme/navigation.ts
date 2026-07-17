import {
  DarkTheme as RNDarkTheme,
  DefaultTheme as RNDefaultTheme,
  type Theme,
} from '@react-navigation/native'
import { darkPalette, lightPalette, type Palette } from './palette'

/**
 * Compose a react-navigation Theme from a companion Palette. Maps our
 * design tokens onto react-navigation's six required color slots:
 *
 *   primary       -> accent    (active states, focused tint)
 *   background    -> background (screen backdrop under the header)
 *   card          -> card      (header + tab bar surface)
 *   text          -> foreground
 *   border        -> border    (hairline under the header, tab bar top edge)
 *   notification  -> destructive (badge tint on tab bar)
 *
 * Fonts inherit from react-navigation's defaults so system fonts +
 * weights keep working on both platforms.
 */
function toNavigationTheme(base: Theme, palette: Palette): Theme {
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.accent,
      background: palette.background,
      card: palette.card,
      text: palette.foreground,
      border: palette.border,
      notification: palette.destructive,
    },
  }
}

export const navigationLightTheme: Theme = toNavigationTheme(
  RNDefaultTheme,
  lightPalette,
)

export const navigationDarkTheme: Theme = toNavigationTheme(
  RNDarkTheme,
  darkPalette,
)
