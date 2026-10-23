import { Text, View } from 'react-native'
// gesture-handler's Pressable, not React Native's: the key rows sit inside
// a Pan recogniser, and RN's own Pressable uses the JS responder system,
// which does not arbitrate with gesture-handler. With RN's, the pan never
// activates over a key and the swipes are dead on exactly the surface
// they are meant to work on.
import { Pressable } from 'react-native-gesture-handler'
import { Icon, type IconName } from '@/components/ui/Icon'
import { SEQ } from './extra-keys.helpers'

interface ExtraKeysBarProps {
  ctrlArmed: boolean
  altArmed: boolean
  onKey: (seq: string) => void
  onToggleCtrl: () => void
  onToggleAlt: () => void
  onMore: () => void
}

export function ExtraKeysBar({
  ctrlArmed,
  altArmed,
  onKey,
  onToggleCtrl,
  onToggleAlt,
  onMore,
}: ExtraKeysBarProps) {
  return (
    <View className="border-border border-t bg-muted">
      <View className="flex-row">
        <KeyButton label="ESC" onPress={() => onKey(SEQ.esc)} />
        <KeyButton label="/" onPress={() => onKey(SEQ.slash)} />
        <KeyButton label="-" onPress={() => onKey(SEQ.dash)} />
        <KeyButton label="HOME" onPress={() => onKey(SEQ.home)} />
        <KeyButton
          label="Up"
          icon="arrow-up"
          onPress={() => onKey(SEQ.arrowUp)}
        />
        <KeyButton label="END" onPress={() => onKey(SEQ.end)} />
        <KeyButton label="PGUP" onPress={() => onKey(SEQ.pageUp)} />
      </View>
      <View className="flex-row">
        <KeyButton label="TAB" onPress={() => onKey(SEQ.tab)} />
        <KeyButton label="CTRL" armed={ctrlArmed} onPress={onToggleCtrl} />
        <KeyButton label="ALT" armed={altArmed} onPress={onToggleAlt} />
        <KeyButton
          label="Left"
          icon="arrow-left"
          onPress={() => onKey(SEQ.arrowLeft)}
        />
        <KeyButton
          label="Down"
          icon="arrow-down"
          onPress={() => onKey(SEQ.arrowDown)}
        />
        <KeyButton
          label="Right"
          icon="arrow-right"
          onPress={() => onKey(SEQ.arrowRight)}
        />
        {/* The last column is split rather than widening the bar: every
            other key keeps its size and the two rows stay on one grid.
            The halves are uneven because a four-letter label does not fit
            in half a column, while the glyph needs almost none. */}
        <KeyButton
          label="PGDN"
          flex={0.62}
          onPress={() => onKey(SEQ.pageDown)}
        />
        <KeyButton
          label="More"
          icon="ellipsis-vertical"
          flex={0.38}
          accessibilityLabel="More actions"
          onPress={onMore}
        />
      </View>
    </View>
  )
}

interface KeyButtonProps {
  /** Spoken name of the key, and the printed one unless `icon` is set. */
  label: string
  /** Drawn instead of the label, for the keys whose face is a symbol. */
  icon?: IconName
  armed?: boolean
  /** Column width relative to a standard key. Defaults to a full column. */
  flex?: number
  accessibilityLabel?: string
  onPress: () => void
}

// fallow-ignore-next-line complexity
function KeyButton({
  label,
  icon,
  armed,
  flex = 1,
  accessibilityLabel,
  onPress,
}: KeyButtonProps) {
  const bgClass = armed ? 'bg-accent' : ''
  const textClass = armed ? 'text-accent-foreground' : 'text-foreground'
  // A split column is too narrow for a four-letter label at the full
  // size, and a key that wraps onto two lines reads as broken. Only the
  // narrowed keys step down, so the rest of the grid is untouched.
  const sizeClass = flex < 1 ? 'text-[10px]' : 'text-xs'
  // The styling lives on an inner View because uniwind resolves
  // `className` for React Native's own components, not for
  // gesture-handler's Pressable: left on the Pressable the keys lose
  // their padding and the rows collapse to text height.
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      // A split column is narrower than the 44pt minimum touch target, so
      // the narrowed keys claim the slack around them instead. Only
      // vertical and right-edge slack: taking it on the left would steal
      // touches from the key next door.
      hitSlop={
        flex < 1
          ? { top: 6, bottom: 6, right: 8, left: 0 }
          : { top: 6, bottom: 6, right: 0, left: 0 }
      }
      style={{ flex }}
    >
      <View className={`items-center justify-center py-3 ${bgClass}`}>
        <KeyFace
          label={label}
          icon={icon}
          armed={armed === true}
          sizeClass={sizeClass}
          textClass={textClass}
        />
      </View>
    </Pressable>
  )
}

/**
 * What the key shows: a symbol for the keys that have one, the label for
 * the rest. Split out so `KeyButton` keeps the single shape it had, and
 * so the icon's tint can follow the armed state the same way the text
 * colour does.
 */
function KeyFace({
  label,
  icon,
  armed,
  sizeClass,
  textClass,
}: {
  label: string
  icon: IconName | undefined
  armed: boolean
  sizeClass: string
  textClass: string
}) {
  if (icon) {
    return (
      <Icon
        name={icon}
        size={15}
        tone={armed ? 'inverted' : 'foreground'}
        label={label}
      />
    )
  }
  return (
    <Text numberOfLines={1} className={`font-mono ${sizeClass} ${textClass}`}>
      {label}
    </Text>
  )
}
