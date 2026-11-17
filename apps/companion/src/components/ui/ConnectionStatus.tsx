import { Pressable, Text, View } from 'react-native'
import {
  CONNECTION_LABEL,
  CONNECTION_TONE,
  chipRoute,
  connectionBanner,
  connectionCopy,
  connectionDetails,
} from '@/modules/wss/connection-state.helpers'
import { useConnection } from '@/modules/wss/connection.hooks'
import type { Action } from './ActionBar'
import { DetailCard } from './DetailCard'
import { RoutePill } from './RoutePill'
import { StateScreen } from './StateScreen'

const DOT = {
  busy: 'bg-accent',
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
} as const

/** States whose full screen keeps the header with the desktop and the chip. */
const HAS_HEADER = {
  connecting: true,
  connected: true,
  reconnecting: true,
  unreachable: true,
  removed: false,
} as const

const BANNER = {
  warn: { box: 'bg-warning/15', text: 'text-warning' },
  bad: { box: 'bg-destructive/15', text: 'text-destructive' },
} as const

/**
 * One status component for every connection state, in three sizes:
 *
 * - `chip`: always in a header. State and, when connected, the route.
 * - `banner`: inside the terminal while the link is down. The live state,
 *   the queue count and, once unreachable, Retry now. Nothing otherwise.
 * - `screen`: the full screen for a state outside a terminal (cold-start
 *   connecting, unreachable, removed), actions in the floating bar.
 *
 * Every size reads the same state, so the header, the terminal and the
 * home screen cannot disagree about the connection.
 */
export function ConnectionStatus({
  size,
  actions = [],
}: {
  size: 'chip' | 'banner' | 'screen'
  /** Screen size only. */
  actions?: readonly Action[]
}) {
  if (size === 'chip') return <StatusChip />
  if (size === 'banner') return <StatusBanner />
  return <StatusScreen actions={actions} />
}

function StatusChip() {
  const connection = useConnection()
  const { state } = connection
  const via = chipRoute(connection)
  return (
    <View
      accessible
      accessibilityLabel={CONNECTION_LABEL[state]}
      className="border-border bg-muted flex-row items-center gap-1.5 rounded-full border px-2 py-0.5"
    >
      <View
        className={`h-1.5 w-1.5 rounded-full ${DOT[CONNECTION_TONE[state]]}`}
      />
      <Text className="text-foreground text-[11px] font-medium">
        {CONNECTION_LABEL[state]}
      </Text>
      {via && <View className="bg-border h-2.5 w-px" />}
      {via && <RoutePill route={via} bare />}
    </View>
  )
}

function StatusBanner() {
  const connection = useConnection()
  const banner = connectionBanner(connection)
  if (!banner) return null
  const look = BANNER[banner.tone]
  return (
    <View
      accessibilityLiveRegion="polite"
      className={`border-border gap-1.5 border-b px-3 py-2 ${look.box}`}
    >
      <Text className={`text-xs ${look.text}`}>{banner.text}</Text>
      {banner.retry && (
        <Pressable
          onPress={connection.retry}
          accessibilityRole="button"
          className="border-destructive self-start rounded-md border px-2 py-0.5"
        >
          <Text className="text-destructive text-xs font-medium">
            Retry now
          </Text>
        </Pressable>
      )}
    </View>
  )
}

function StatusScreen({ actions }: { actions: readonly Action[] }) {
  const connection = useConnection()
  const { state, desk, route } = connection
  const copy = connectionCopy(state, desk, route)
  const rows = connectionDetails(connection)
  return (
    <StateScreen
      tone={CONNECTION_TONE[state]}
      title={copy.title}
      body={copy.body}
      actions={actions}
      header={HAS_HEADER[state] ? <ScreenHeader desk={desk} /> : undefined}
    >
      {rows.length > 0 && <DetailCard rows={rows} />}
    </StateScreen>
  )
}

/** The desktop's name and the chip, above a full-screen state. */
function ScreenHeader({ desk }: { desk: string }) {
  return (
    <View className="border-border flex-row items-center gap-2 border-b px-4 py-2">
      <Text
        numberOfLines={1}
        className="text-foreground flex-1 text-sm font-semibold"
      >
        {desk}
      </Text>
      <StatusChip />
    </View>
  )
}
