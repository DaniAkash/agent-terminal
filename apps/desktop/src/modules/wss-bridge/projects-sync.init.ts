import { IPC } from '@/modules/ipc/commands'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { $tabRecency, $tabRecencyTimes } from '@/modules/stores/$tabRecency'
import { buildSyncPayload } from './projects-sync.helpers'

/* ---------------------------------------------------------------------------
 * One-shot subscriber that pushes the enriched project tree into the Rust
 * ProjectsCache, which fans it out to every paired mobile client.
 *
 * Three stores feed it: $projects (structure), $tabMeta (agent state) and
 * $tabRecency (MRU order). Only the first used to trigger a sync, which is
 * why mobile could not see agent state or recency at all.
 *
 * Lives outside any component lifecycle so it never double-attaches under
 * React StrictMode and survives hot-reload. Mirrors `initTabRecencySubscriber`.
 * -------------------------------------------------------------------------*/

let initialised = false
let scheduled = false

function flush(): void {
  scheduled = false
  IPC.syncProjectsToWss(
    buildSyncPayload($projects.get(), $tabMeta.get(), $tabRecencyTimes.get()),
    true,
  ).catch(() => {})
}

/**
 * Coalesce to one sync per tick. A single agent turn writes $tabMeta and
 * $tabRecency in the same microtask batch; without this each write would
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
  $tabRecency.listen(schedule)
  // Explicit first push. Rust needs `hydrated: true` before it will accept
  // mobile CRUD, and `.listen()` deliberately skips the initial fire, so an
  // untouched desktop would otherwise never flip the flag.
  flush()
}
