import { $activeProjectId, $activeTabId } from '@/modules/stores/$navigation'
import { bumpTabRecency } from '@/modules/stores/$tabRecency'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'

/* ---------------------------------------------------------------------------
 * One-shot subscriber that turns navigation changes into recency bumps.
 *
 * Lives outside any component lifecycle so it never double-attaches under
 * React StrictMode and survives hot-reload. Called once from main.tsx
 * before <App/> renders. Mirrors the `initNavigation` pattern already in
 * the repo.
 * -------------------------------------------------------------------------*/

let initialised = false
let lastKey = ''

function check(): void {
  const projectId = $activeProjectId.get()
  const tabId = $activeTabId.get()[projectId]
  if (!projectId || !tabId) return
  const key = makeTabKey(projectId, tabId)
  if (key === lastKey) return
  lastKey = key
  bumpTabRecency(key)
}

export function initTabRecencySubscriber(): void {
  if (initialised) return
  initialised = true
  // `.listen()` (not `.subscribe()`) skips the synchronous initial fire so
  // we don't bump twice for the same starting state. The explicit `check()`
  // at the end handles the initial-state bump intentionally.
  $activeProjectId.listen(check)
  $activeTabId.listen(check)
  check()
}
