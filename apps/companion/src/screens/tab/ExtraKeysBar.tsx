import { Pressable, Text, View } from 'react-native'
import { SEQ } from './extra-keys.helpers'

interface ExtraKeysBarProps {
  ctrlArmed: boolean
  altArmed: boolean
  onKey: (seq: string) => void
  onToggleCtrl: () => void
  onToggleAlt: () => void
}

export function ExtraKeysBar({
  ctrlArmed,
  altArmed,
  onKey,
  onToggleCtrl,
  onToggleAlt,
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
        <KeyButton label="PGDN" onPress={() => onKey(SEQ.pageDown)} />
      </View>
    </View>
  )
}

interface KeyButtonProps {
  label: string
  armed?: boolean
  onPress: () => void
}

function KeyButton({ label, armed, onPress }: KeyButtonProps) {
  const bgClass = armed ? 'bg-accent' : ''
  const textClass = armed ? 'text-accent-foreground' : 'text-foreground'
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 items-center justify-center py-3 ${bgClass}`}
    >
      <Text className={`font-mono text-xs ${textClass}`}>{label}</Text>
    </Pressable>
  )
}
