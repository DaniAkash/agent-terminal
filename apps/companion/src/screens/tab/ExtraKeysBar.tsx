import { Text, View } from 'react-native'
// gesture-handler's Pressable, not React Native's: the key rows sit inside
// a Pan recogniser, and RN's own Pressable uses the JS responder system,
// which does not arbitrate with gesture-handler. With RN's, the pan never
// activates over a key and the swipes are dead on exactly the surface
// they are meant to work on.
import { Pressable } from 'react-native-gesture-handler'
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
        <KeyButton label="↑" onPress={() => onKey(SEQ.arrowUp)} />
        <KeyButton label="END" onPress={() => onKey(SEQ.end)} />
        <KeyButton label="PGUP" onPress={() => onKey(SEQ.pageUp)} />
      </View>
      <View className="flex-row">
        <KeyButton label="TAB" onPress={() => onKey(SEQ.tab)} />
        <KeyButton label="CTRL" armed={ctrlArmed} onPress={onToggleCtrl} />
        <KeyButton label="ALT" armed={altArmed} onPress={onToggleAlt} />
        <KeyButton label="←" onPress={() => onKey(SEQ.arrowLeft)} />
        <KeyButton label="↓" onPress={() => onKey(SEQ.arrowDown)} />
        <KeyButton label="→" onPress={() => onKey(SEQ.arrowRight)} />
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
          label="⋮"
          flex={0.38}
          accessibilityLabel="More actions"
          onPress={onMore}
        />
      </View>
    </View>
  )
}

interface KeyButtonProps {
  label: string
  armed?: boolean
  /** Column width relative to a standard key. Defaults to a full column. */
  flex?: number
  accessibilityLabel?: string
  onPress: () => void
}

function KeyButton({
  label,
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
      style={{ flex }}
    >
      <View className={`items-center justify-center py-3 ${bgClass}`}>
        <Text
          numberOfLines={1}
          className={`font-mono ${sizeClass} ${textClass}`}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  )
}
