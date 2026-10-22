import type { AgentMark } from '@agent-terminal/core-ui'

/**
 * Renders shared mark geometry as DOM SVG. The companion has a file the
 * same size doing the same job with react-native-svg; between them they
 * are the only code that knows which element type it is drawing into.
 *
 * The inline width/height style is load-bearing, not belt and braces.
 * cmdk's `[cmdk-item]` styles include
 * `[&_svg:not([class*='size-'])]:size-4`, which hijacks any descendant
 * SVG to 16px inside the TabSwitcher. Attributes alone lose to it.
 */
export function AgentMarkSvg({
  mark,
  size,
}: {
  mark: AgentMark
  size: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={mark.viewBox}
      fill="currentColor"
      fillRule={mark.fillRule}
      clipRule={mark.fillRule}
      preserveAspectRatio="xMidYMid"
      style={{ display: 'block', width: size, height: size }}
      aria-hidden="true"
    >
      {mark.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
