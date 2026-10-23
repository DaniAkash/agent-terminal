import Lucide, { type LucideIconName } from '@react-native-vector-icons/lucide'
import type { Palette } from '@/modules/theme/palette'
import { usePalette } from '@/modules/theme/theme.hooks'

/**
 * The tints an icon is allowed to take, named for the role rather than
 * the palette key, so a caller picks an intent and the mapping to a
 * token stays in one place.
 */
const TONES = {
  foreground: 'foreground',
  /** On an accent-filled surface, where the foreground tone would vanish. */
  inverted: 'accentForeground',
  muted: 'mutedForeground',
  accent: 'accent',
  destructive: 'destructive',
  success: 'success',
  warning: 'warning',
} as const satisfies Record<string, keyof Palette>

type IconTone = keyof typeof TONES
export type IconName = LucideIconName

interface IconProps {
  name: IconName
  size?: number
  tone?: IconTone
  /**
   * Spoken name, for an icon that is the only content of its control.
   * Left off, the icon is hidden from the screen reader, which is right
   * whenever the surrounding pressable is already labelled: an icon
   * announced inside a labelled control is read twice.
   */
  label?: string
}

/**
 * Lucide, the same icon set the desktop imports from `lucide-react`,
 * drawn here from the icon font so the two apps use one set rather than
 * two that happen to look similar.
 *
 * The tint is a prop rather than a class because uniwind resolves
 * `className` for React Native's own components only, and this renders a
 * third party's `Text` subclass.
 */
export function Icon({ name, size = 16, tone = 'muted', label }: IconProps) {
  const palette = usePalette()
  return (
    <Lucide
      name={name}
      size={size}
      color={palette[TONES[tone]]}
      accessible={label !== undefined}
      accessibilityLabel={label}
      importantForAccessibility={label === undefined ? 'no' : 'yes'}
    />
  )
}
