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
  /**
   * Whether `projects` came from this connection's own Projects frame.
   *
   * `connected` is set on auth_ok, which the desktop sends BEFORE the tree, so
   * status alone cannot distinguish "no projects" from "not told yet". On a
   * reconnect the array still holds the previous session's tree. Anything that
   * branches on the tree's contents waits for this instead.
   */
  projectsLoaded: boolean
  lastError: string | null
  lastConnectedAt: number | null
}

export const $session = map<Session>({
  status: 'disconnected',
  deviceName: null,
  projects: [],
  projectsLoaded: false,
  lastError: null,
  lastConnectedAt: null,
})

export function resetSession(): void {
  $session.set({
    status: 'disconnected',
    deviceName: null,
    projects: [],
    projectsLoaded: false,
    lastError: null,
    lastConnectedAt: null,
  })
}
