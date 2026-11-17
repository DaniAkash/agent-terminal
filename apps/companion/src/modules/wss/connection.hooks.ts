import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { $activeDevice, type DeviceRecord } from '@/modules/stores/$devices'
import { $removal } from '@/modules/stores/$removal'
import { $session } from '@/modules/stores/$session'
import { autoConnect } from './client'
import {
  type ConnectionView,
  connectionView,
  RECONNECTING_MS,
} from './connection-state.helpers'

function retry(record: DeviceRecord | null): void {
  if (record) void autoConnect(record)
}

/** The connection as the status component shows it, in every size. */
export function useConnection(): ConnectionView & { retry: () => void } {
  const session = useStore($session)
  const record = useStore($activeDevice).record
  const removal = useStore($removal)
  const [, setTick] = useState(0)

  // useEffect exception: a timer tied to a value. Reconnecting turns into
  // Unreachable 30 s after the loss with no event of its own, so one
  // timeout re-renders at that moment.
  useEffect(() => {
    if (session.downSince === null) return
    const left = session.downSince + RECONNECTING_MS - Date.now()
    if (left <= 0) return
    const id = setTimeout(() => setTick((n) => n + 1), left + 50)
    return () => clearTimeout(id)
  }, [session.downSince])

  const view = connectionView({ ...session, removal, record, now: Date.now() })
  return { ...view, retry: () => retry(record) }
}
