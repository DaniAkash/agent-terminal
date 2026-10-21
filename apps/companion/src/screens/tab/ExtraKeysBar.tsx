import { ScrollView, Text, View } from 'react-native'
// gesture-handler's Pressable, not React Native's: the key rows sit inside
// a Pan recogniser, and RN's own Pressable uses the JS responder system,
// which does not arbitrate with gesture-handler. With RN's, the pan never
// activates over a key and the swipes are dead on exactly the surface
// they are meant to work on.
import { Pressable } from 'react-native-gesture-handler'
import { COMBOS, SEQ } from './extra-keys.helpers'

interface ExtraKeysBarProps {
  ctrlArmed: boolean
  altArmed: boolean
  onKey: (seq: string) => void
  onCombo: (seq: string) => void
  onToggleCtrl: () => void
  onToggleAlt: () => void
  onMore: () => void
}

/**
 * Two horizontally-scrolling rows instead of a fixed grid: a fixed grid
 * forces every key to shrink to fit the screen width, which is what left
 * PGDN and the more-actions key narrower than the 44pt touch-target
 * minimum. Scrolling lets every key keep a full-size target and leaves
 * room to add more without shrinking the rest.
 *
 * Row 1 is the one-tap chords (Ctrl+C/D/Z/L) plus the Ctrl/Alt arm
 * toggles for everything else. Row 2 is cursor/navigation. Ordered this
 * way because the chords are reached for mid-typing, while the nav row
 * is usually a short multi-tap run (e.g. End, End, Home) that benefits
 * from staying put once the thumb finds it.
 */
export function ExtraKeysBar({
  ctrlArmed,
  altArmed,
  onKey,
  onCombo,
  onToggleCtrl,
  onToggleAlt,
  onMore,
}: ExtraKeysBarProps) {
  return (
    <View className="border-border border-t bg-muted">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 8, paddingTop: 8 }}
      >
        <ComboButton
          label="⌃C"
          accessibilityLabel="Send Ctrl+C"
          onPress={() => onCombo(COMBOS.ctrlC)}
        />
        <ComboButton
          label="⌃D"
          accessibilityLabel="Send Ctrl+D"
          onPress={() => onCombo(COMBOS.ctrlD)}
        />
        <ComboButton
          label="⌃Z"
          accessibilityLabel="Send Ctrl+Z"
          onPress={() => onCombo(COMBOS.ctrlZ)}
        />
        <ComboButton
          label="⌃L"
          accessibilityLabel="Send Ctrl+L, clear screen"
          onPress={() => onCombo(COMBOS.ctrlL)}
        />
        <View className="my-1.5 w-px bg-border" />
        <ComboButton
          label="CTRL"
          armed={ctrlArmed}
          accessibilityLabel="Arm Ctrl for the next key"
          onPress={onToggleCtrl}
        />
        <ComboButton
          label="ALT"
          armed={altArmed}
          accessibilityLabel="Arm Alt for the next key"
          onPress={onToggleAlt}
        />
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{
          gap: 6,
          paddingHorizontal: 8,
          paddingVertical: 8,
        }}
      >
        <KeyButton label="ESC" onPress={() => onKey(SEQ.esc)} />
        <KeyButton label="TAB" onPress={() => onKey(SEQ.tab)} />
        <KeyButton label="/" onPress={() => onKey(SEQ.slash)} />
        <KeyButton label="-" onPress={() => onKey(SEQ.dash)} />
        <KeyButton label="HOME" onPress={() => onKey(SEQ.home)} />
        <KeyButton label="END" onPress={() => onKey(SEQ.end)} />
        <KeyButton label="PGUP" onPress={() => onKey(SEQ.pageUp)} />
        <KeyButton label="PGDN" onPress={() => onKey(SEQ.pageDown)} />
        <KeyButton
          label="←"
          accessibilityLabel="Arrow left"
          onPress={() => onKey(SEQ.arrowLeft)}
        />
        <KeyButton
          label="↑"
          accessibilityLabel="Arrow up"
          onPress={() => onKey(SEQ.arrowUp)}
        />
        <KeyButton
          label="↓"
          accessibilityLabel="Arrow down"
          onPress={() => onKey(SEQ.arrowDown)}
        />
        <KeyButton
          label="→"
          accessibilityLabel="Arrow right"
          onPress={() => onKey(SEQ.arrowRight)}
        />
        <KeyButton
          label="⋮"
          accessibilityLabel="More actions"
          onPress={onMore}
        />
      </ScrollView>
    </View>
  )
}

interface KeyButtonProps {
  label: string
  accessibilityLabel?: string
  onPress: () => void
}

/** A navigation/control key: fixed 44pt square, never shrinks. */
function KeyButton({ label, accessibilityLabel, onPress }: KeyButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={{ width: 44, height: 44 }}
      className="items-center justify-center rounded-lg bg-background"
    >
      <Text numberOfLines={1} className="font-mono text-foreground text-xs">
        {label}
      </Text>
    </Pressable>
  )
}

interface ComboButtonProps {
  label: string
  armed?: boolean
  accessibilityLabel: string
  onPress: () => void
}

/** A labelled pill: wider than a single key so "⌃C" / "CTRL" read clearly. */
function ComboButton({
  label,
  armed,
  accessibilityLabel,
  onPress,
}: ComboButtonProps) {
  const bgClass = armed ? 'bg-accent' : 'bg-background'
  const textClass = armed ? 'text-accent-foreground' : 'text-foreground'
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: armed }}
      style={{ minWidth: 44, height: 44 }}
      className={`items-center justify-center rounded-full px-4 ${bgClass}`}
    >
      <Text numberOfLines={1} className={`font-mono text-xs ${textClass}`}>
        {label}
      </Text>
    </Pressable>
  )
}
