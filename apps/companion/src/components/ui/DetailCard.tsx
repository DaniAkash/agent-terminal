import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { Route } from '@/modules/wss/route.helpers'
import { RoutePill } from './RoutePill'

export interface DetailRow {
  label: string
  /** Plain text, or a route with the address it was reached at. */
  value: string | { route: Route; address?: string | undefined }
  mono?: boolean
}

/**
 * A card of facts, each label above its value, both left-aligned, so a
 * long value (a fingerprint, a MagicDNS name) wraps under its own label
 * instead of pushing it off the row. Used on the confirm screen, the
 * waiting sheet and the connection screens.
 */
export function DetailCard({
  rows,
  children,
}: {
  rows: readonly DetailRow[]
  children?: ReactNode
}) {
  return (
    <View className="border-border bg-card w-full gap-3 rounded-md border p-3">
      {rows.map((row) => (
        <View key={row.label} className="items-start gap-1">
          <Text className="text-muted-foreground text-xs">{row.label}</Text>
          <DetailValue row={row} />
        </View>
      ))}
      {children}
    </View>
  )
}

function DetailValue({ row }: { row: DetailRow }) {
  if (typeof row.value === 'string') {
    return (
      <Text
        className={`text-foreground text-left text-sm ${row.mono ? 'font-mono' : ''}`}
      >
        {row.value}
      </Text>
    )
  }
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <RoutePill route={row.value.route} />
      {row.value.address !== undefined && (
        <Text className="text-muted-foreground font-mono text-xs">
          {row.value.address}
        </Text>
      )}
    </View>
  )
}
