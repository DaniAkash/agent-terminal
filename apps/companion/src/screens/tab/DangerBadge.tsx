import { Text } from 'react-native'

/**
 * 🤘 when the agent was launched with a full-permissions flag.
 *
 * The same character the desktop sidebar uses, deliberately: this badge
 * is the one piece of the session row a user learns to spot across both
 * devices, and two different marks would undo that.
 */
export function DangerBadge({ size = 11 }: { size?: number }) {
  return (
    <Text
      accessibilityLabel="All permissions enabled"
      style={{ fontSize: size, lineHeight: size * 1.2 }}
    >
      🤘
    </Text>
  )
}
