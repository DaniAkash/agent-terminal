import { Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { usePalette } from '@/modules/theme/theme.hooks'
import { type Route, routeLabel } from '@/modules/wss/route.helpers'
import { Icon } from './Icon'

/** Centres of the nine dots of the Tailscale mark; `faint` ones are drawn at 20 %. */
const TAILSCALE_DOTS: readonly { cx: number; cy: number; faint: boolean }[] = [
  { cx: 40.625, cy: 39.625, faint: true },
  { cx: 60.5, cy: 39.625, faint: true },
  { cx: 80.375, cy: 39.625, faint: true },
  { cx: 40.625, cy: 59.5, faint: false },
  { cx: 60.5, cy: 59.5, faint: false },
  { cx: 80.375, cy: 59.5, faint: false },
  { cx: 40.625, cy: 79.375, faint: true },
  { cx: 60.5, cy: 79.375, faint: false },
  { cx: 80.375, cy: 79.375, faint: true },
]

/** The Tailscale nine-dot mark, in the foreground colour. */
function TailscaleMark({ size }: { size: number }) {
  const palette = usePalette()
  return (
    <Svg width={size} height={size} viewBox="31 30 59 59">
      {TAILSCALE_DOTS.map((dot) => (
        <Circle
          key={`${dot.cx}-${dot.cy}`}
          cx={dot.cx}
          cy={dot.cy}
          r={6.625}
          fill={palette.foreground}
          opacity={dot.faint ? 0.2 : 1}
        />
      ))}
    </Svg>
  )
}

/**
 * Names the route a connection runs over: the Tailscale mark and
 * "Tailscale", or the Wi-Fi icon and "Wi-Fi". Icon on the left, name on
 * the right. `bare` drops the pill's own background for use inside the
 * header status chip, which already is one.
 */
export function RoutePill({
  route,
  bare = false,
}: {
  route: Route
  bare?: boolean
}) {
  return (
    <View
      accessible
      accessibilityLabel={`Route: ${routeLabel(route)}`}
      className={
        bare
          ? 'flex-row items-center gap-1'
          : 'border-border bg-accent-soft flex-row items-center gap-1.5 self-start rounded-full border py-0.5 pr-2 pl-1.5'
      }
    >
      {route === 'tailscale' ? (
        <TailscaleMark size={12} />
      ) : (
        <Icon name="wifi" size={12} tone="accent" />
      )}
      <Text className="text-foreground text-[11px] font-medium">
        {routeLabel(route)}
      </Text>
    </View>
  )
}
