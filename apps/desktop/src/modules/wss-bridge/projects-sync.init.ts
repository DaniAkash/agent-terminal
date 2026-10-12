import { IPC } from '@/modules/ipc/commands'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { $tabRecencyTimes } from '@/modules/stores/$tabRecency'
import {
  type AgentStateStamp,
  buildSyncPayload,
  stampAgentStates,
} from './projects-sync.helpers'

/* ---------------------------------------------------------------------------
 * One-shot subscriber that pushes the enriched project tree into the Rust
 * ProjectsCache, which fans it out to every paired mobile client.
 *
 * Three stores feed it: $projects (structure), $tabMeta (agent state) and
 * $tabRecencyTimes (last-activated stamps). Only the first used to trigger a
 * sync, which is why mobile could not see agent state or recency at all.
 *
 * It is the times atom rather than $tabRecency that is watched, because that
 * is the one the payload reads: re-activating the tab already at the front of
 * the MRU list leaves the order untouched and bumps only the timestamp.
 *
 * Lives outside any component lifecycle so it never double-attaches under
 * React StrictMode and survives hot-reload. Mirrors `initTabRecencySubscriber`.
 * -------------------------------------------------------------------------*/

let initialised = false
let scheduled = false
let agentStateStamps: Record<string, AgentStateStamp> = {}

function flush(): void {
  scheduled = false
  const projects = $projects.get()
  const meta = $tabMeta.get()
  agentStateStamps = stampAgentStates(
    projects,
    meta,
    agentStateStamps,
    Date.now(),
  )
  IPC.syncProjectsToWss(
    buildSyncPayload(projects, meta, $tabRecencyTimes.get(), agentStateStamps),
    true,
  ).catch(() => {})
}

/**
 * Coalesce to one sync per tick. A single agent turn writes $tabMeta and
 * $tabRecencyTimes in the same microtask batch; without this each write would
 * serialise the whole tree over IPC and push a frame to every mobile client.
 */
function schedule(): void {
  if (scheduled) return
  scheduled = true
  queueMicrotask(flush)
}

export function initProjectsSync(): void {
  if (initialised) return
  initialised = true
  $projects.listen(schedule)
  $tabMeta.listen(schedule)
  $tabRecencyTimes.listen(schedule)
  // Explicit first push. Rust needs `hydrated: true` before it will accept
  // mobile CRUD, and `.listen()` deliberately skips the initial fire, so an
  // untouched desktop would otherwise never flip the flag.
  flush()
}
