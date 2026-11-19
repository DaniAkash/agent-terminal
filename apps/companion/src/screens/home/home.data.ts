import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { Alert } from 'react-native'
import { $activeDevice, clearDevice } from '@/modules/stores/$devices'
import { $removal, clearRemoval } from '@/modules/stores/$removal'
import { $session } from '@/modules/stores/$session'
import { autoConnect, disconnect } from '@/modules/wss/client'
import { useConnection } from '@/modules/wss/connection.hooks'

/**
 * Home screen state, in the connection vocabulary:
 *
 * - `removed`: the desktop revoked this phone. Say so, offer to pair again.
 * - `unpaired`: no DeviceRecord in secure-store; show the CTA.
 * - `connecting`: a cold start whose ladder is still working.
 * - `connected`: up, or briefly reconnecting (the header chip says which).
 * - `unreachable`: given up for now; the full screen with Retry now.
 */
export function useHomeData() {
  const session = useStore($session)
  const device = useStore($activeDevice)
  const removal = useStore($removal)
  const connection = useConnection()
  const record = device.record

  const kind:
    | 'removed'
    | 'unpaired'
    | 'connecting'
    | 'connected'
    | 'unreachable' = (() => {
    if (removal) return 'removed'
    if (record === null) return 'unpaired'
    if (connection.state === 'connected') return 'connected'
    if (connection.state === 'reconnecting') return 'connected'
    if (connection.state === 'unreachable') return 'unreachable'
    return 'connecting'
  })()

  return {
    kind,
    session,
    device,
    hint: record?.deviceHint ?? null,
    projectCount: session.projects.length,
    // Includes sleeping tabs (tabs defined in projects.json but not
    // currently spawned). Matches the desktop sidebar's "defined" count.
    tabCount: session.projects.reduce((n, p) => n + p.tabs.length, 0),
    disconnect,
    /** Kick the resolver ladder again from an "unreachable" state. */
    retry: () => {
      if (record) void autoConnect(record)
    },
    /** Leave the Removed screen for the scanner. */
    pairAgain: () => {
      clearRemoval()
      router.replace('/pair')
    },
    /** Leave the Removed screen for the first-run one. */
    dismissRemoval: clearRemoval,
    /**
     * Escape from any bricked state (unreachable, or connecting-and-
     * stuck). Confirms via native Alert because the token is destroyed
     * and the user has to re-scan the QR to pair again. Called from
     * UnreachableHome + the stuck-timer branch of ConnectingHome.
     */
    unpair: () => {
      Alert.alert(
        'Unpair from desktop?',
        "You'll need to scan the QR from your desktop again to reconnect.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unpair',
            style: 'destructive',
            onPress: () => {
              disconnect()
              void clearDevice().finally(() => {
                router.replace('/pair')
              })
            },
          },
        ],
      )
    },
  }
}
