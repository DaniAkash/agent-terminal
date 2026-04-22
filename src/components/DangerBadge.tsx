/**
 * 🤘 badge shown when an agent tab is running with full permissions.
 *
 * - claude-code: --dangerously-skip-permissions
 * - codex:       --yolo
 *
 * The badge and tooltip are the same regardless of which flag triggered it.
 */
export function DangerBadge({ size = 12 }: { size?: number }) {
  return (
    <span
      role="img"
      title="All permissions enabled"
      aria-label="All permissions enabled"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size,
        lineHeight: 1,
        cursor: 'help',
      }}
    >
      🤘
    </span>
  )
}
