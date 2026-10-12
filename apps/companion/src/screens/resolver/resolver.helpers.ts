import type { Href } from 'expo-router'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import { splitTabId } from '@/screens/tab/tab.helpers'

export interface LandingInput {
  deviceLoaded: boolean
  hasDevice: boolean
  /** Raw WSS status, not a boolean: "still connecting" and "gave up" must
   *  lead to different landings. */
  status: string
  /** Whether `projects` is this connection's answer. See `$session`. */
  projectsLoaded: boolean
  projects: ProjectSummary[]
  /** Composed wire id of the session last worked in on this desktop. */
  lastTabId: string | null
}

/**
 * Where a cold start lands, or `null` to keep waiting.
 *
 * Returning null matters: the stores settle asynchronously, and a
 * resolver that commits on first render always decides before the socket
 * is up, so it would send every launch to home and never restore the
 * last session. Waiting is bounded, since the ladder lands on
 * `unreachable` or `auth_failed` rather than retrying forever.
 */
export function resolveLanding(input: LandingInput): Href | null {
  if (!input.deviceLoaded) return null
  if (!input.hasDevice) return '/pair'

  // Terminal failures stop the wait; anything else is still in flight.
  if (input.status === 'unreachable' || input.status === 'auth_failed') {
    return '/home'
  }
  // Not just `connected`: the desktop sends its tree in a frame of its own
  // after auth_ok, so a freshly connected session still reports an empty (or,
  // on reconnect, a stale) tree. Resolving there would send every launch home.
  // An empty tree IS a valid answer once the frame has landed, which is why
  // this waits on the flag rather than on `projects.length`.
  if (input.status !== 'connected' || !input.projectsLoaded) return null

  if (input.lastTabId) {
    const parts = splitTabId(input.lastTabId)
    // A session deleted while the phone slept would otherwise deep link
    // into a dead tab, so an unknown id falls back rather than erroring.
    const stillThere =
      parts !== null &&
      input.projects.some(
        (project) =>
          project.project_id === parts.projectId &&
          project.tabs.some((tab) => tab.tab_id === input.lastTabId),
      )
    if (parts && stillThere) {
      return `/tab/${parts.projectId}/${parts.tabId}` as Href
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
  session: {
    status: string
    projects: ProjectSummary[]
    projectsLoaded: boolean
  },
  lastSessions: Record<string, string>,
): LandingInput {
  const deviceId = device.record?.deviceId
  return {
    deviceLoaded: device.loaded,
    hasDevice: device.record !== null,
    status: session.status,
    projectsLoaded: session.projectsLoaded,
    projects: session.projects,
    lastTabId: deviceId ? (lastSessions[deviceId] ?? null) : null,
  }
}
