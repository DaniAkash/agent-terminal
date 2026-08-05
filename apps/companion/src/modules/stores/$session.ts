import { map } from 'nanostores'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'

type SessionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'auth_failed'
  | 'unreachable'

type Session = {
  status: SessionStatus
  deviceName: string | null
  projects: ProjectSummary[]
  lastError: string | null
  lastConnectedAt: number | null
}

export const $session = map<Session>({
  status: 'disconnected',
  deviceName: null,
  projects: [],
  lastError: null,
  lastConnectedAt: null,
})

export function resetSession(): void {
  $session.set({
    status: 'disconnected',
    deviceName: null,
    projects: [],
    lastError: null,
    lastConnectedAt: null,
  })
}
