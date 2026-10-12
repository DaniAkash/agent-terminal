import { useStore } from '@nanostores/react'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { $devices, setActiveDevice } from '@/modules/stores/$devices'
import { $session } from '@/modules/stores/$session'
import { type DesktopRow, desktopRows } from './desktops.helpers'

/**
 * Pick which paired desktop the phone drives.
 *
 * Switching only changes the active record; the socket is moved by the
 * `$activeDevice` subscriber in the wss bootstrap, which tears the old one
 * down before starting the new ladder. The row shows its own progress so a
 * desktop that is asleep fails visibly here rather than silently leaving
 * the app pointed at nothing.
 */
// fallow-ignore-next-line complexity
export function DesktopsSheet() {
  const devices = useStore($devices)
  const session = useStore($session)
  const router = useRouter()
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)

  const rows = desktopRows(devices.byId, devices.activeId)

  async function choose(row: DesktopRow) {
    if (row.isActive) {
      router.back()
      return
    }
    setSwitchingTo(row.deviceId)
    await setActiveDevice(row.deviceId)
  }

  // Once the new desktop is up, the sheet has done its job.
  if (switchingTo !== null && devices.activeId === switchingTo) {
    if (session.status === 'connected') {
      router.back()
    }
  }

  return (
    <View collapsable={false} className="flex-1 bg-background">
      <View className="px-4 pt-3 pb-1">
        <Text className="font-semibold text-base text-foreground">
          Desktops
        </Text>
        <Text className="text-muted-foreground text-xs">
          Each desktop keeps its own sessions and its own last-opened one.
        </Text>
      </View>

      {rows.length === 0 ? (
        <Text className="px-4 py-6 text-muted-foreground text-sm">
          No desktops paired yet.
        </Text>
      ) : (
        <View className="gap-1 p-2">
          {rows.map((row) => (
            <DesktopRowItem
              key={row.deviceId}
              row={row}
              busy={switchingTo === row.deviceId}
              status={row.isActive ? session.status : null}
              onPress={() => void choose(row)}
            />
          ))}
        </View>
      )}

      <Pressable
        onPress={() => router.replace('/pair')}
        accessibilityRole="button"
        className="mx-4 mt-2 items-center rounded-md border border-border px-3 py-2.5 active:bg-accent-soft"
      >
        <Text className="text-foreground text-sm">Pair another desktop</Text>
      </Pressable>
    </View>
  )
}

interface DesktopRowItemProps {
  row: DesktopRow
  busy: boolean
  status: string | null
  onPress: () => void
}

// Complexity here is branch-per-prop JSX, not logic: the derivation it
// renders lives in tested pure helpers alongside. CRAP is high because
// this repo has no component-test harness, not because the function is
// hard to follow. Follow-up: a render-level test setup would retire this.
// fallow-ignore-next-line complexity
function DesktopRowItem({ row, busy, status, onPress }: DesktopRowItemProps) {
  const failed = status === 'unreachable' || status === 'auth_failed'
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`${row.name}${row.isActive ? ', connected' : ''}. ${row.endpoint}`}
      className={`flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent-soft ${
        row.isActive ? 'bg-accent-soft' : ''
      }`}
    >
      <View
        className={`h-2 w-2 rounded-full ${
          failed
            ? 'bg-destructive'
            : row.isActive
              ? 'bg-success'
              : 'bg-muted-foreground/40'
        }`}
      />
      <View className="flex-1">
        <Text numberOfLines={1} className="font-medium text-foreground text-sm">
          {row.name}
        </Text>
        <Text numberOfLines={1} className="text-muted-foreground text-xs">
          {failed ? 'Could not be reached' : row.endpoint}
        </Text>
      </View>
      {busy && <ActivityIndicator size="small" />}
    </Pressable>
  )
}
