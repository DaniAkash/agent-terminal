import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import { splitTabId } from '@/screens/tab/tab.helpers'

export interface LandingInput {
  deviceLoaded: boolean
  hasDevice: boolean
  connected: boolean
  projects: ProjectSummary[]
  /** Composed wire id of the session last worked in on this desktop. */
  lastTabId: string | null
}

/**
 * Where a cold start lands.
 *
 * The "still in the tree" check matters: a session deleted on the desktop
 * while the phone slept would otherwise deep link into a dead tab, so an
 * unknown id falls back to the home surface rather than rendering an
 * error.
 */
export function resolveLanding(input: LandingInput): string {
  if (!input.deviceLoaded) return '/home'
  if (!input.hasDevice) return '/pair'
  if (!input.connected) return '/home'

  if (input.lastTabId) {
    const parts = splitTabId(input.lastTabId)
    const stillThere =
      parts !== null &&
      input.projects.some(
        (project) =>
          project.project_id === parts.projectId &&
          project.tabs.some((tab) => tab.tab_id === input.lastTabId),
      )
    if (parts && stillThere) {
      return `/tab/${parts.projectId}/${parts.tabId}`
    }
  }
  return '/home'
}

/**
 * Assemble the resolver's input from the three stores it reads. Pure, so
 * the branching lives somewhere testable rather than inside the component.
 */
export function landingInput(
  device: { loaded: boolean; record: { deviceId: string } | null },
  session: { status: string; projects: ProjectSummary[] },
  lastSessions: Record<string, string>,
): LandingInput {
  const deviceId = device.record?.deviceId
  return {
    deviceLoaded: device.loaded,
    hasDevice: device.record !== null,
    connected: session.status === 'connected',
    projects: session.projects,
    lastTabId: deviceId ? (lastSessions[deviceId] ?? null) : null,
  }
}
