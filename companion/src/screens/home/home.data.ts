import { useStore } from '@nanostores/react'
import { $device } from '@/modules/stores/$device'
import { $session } from '@/modules/stores/$session'
import { autoConnect, disconnect } from '@/modules/wss/client'

/**
 * Home screen state. Three-way split driven by `$device` (has a
 * paired record?) + `$session.status` (WSS live?):
 *
 * - `unpaired`: no DeviceRecord in secure-store; show the CTA.
 * - `connecting`: device present but the resolver ladder is still
 *   working (or the client is mid-auth). Show a spinner + hint.
 * - `connected`: WSS is up; show the projects/stats/disconnect UI.
 * - `unreachable`: device present, ladder exhausted or auth failed.
 *   Show retry.
 */
export function useHomeData() {
  const session = useStore($session)
  const device = useStore($device)
  const record = device.record
  const status = session.status

  const isConnected = status === 'connected'
  const hasDevice = record !== null
  const kind: 'unpaired' | 'connecting' | 'connected' | 'unreachable' = (() => {
    if (!hasDevice) return 'unpaired'
    if (isConnected) return 'connected'
    if (status === 'unreachable' || status === 'auth_failed')
      return 'unreachable'
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
  }
}
