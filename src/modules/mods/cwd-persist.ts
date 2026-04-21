import { updateTabCwd } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'

const DEBOUNCE_MS = 2000

/**
 * Subscribes to $tabMeta and debounces CWD write-backs into $projects.
 *
 * When DirTrackerMod emits a cwd_changed event, $tabMeta is updated immediately.
 * This module waits 2s after the last *cwd change* per tab before persisting it
 * to Tab.lastCwd. Updates to other meta fields (git, status, ports) do not reset
 * the timer, preventing those frequent updates from starving the write-back.
 *
 * Called once in main.tsx bootstrap, after startModListener().
 */
export function startCwdPersist(): void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const lastSeen = new Map<string, string>()

  $tabMeta.subscribe((allMeta) => {
    for (const [tabKey, meta] of Object.entries(allMeta)) {
      if (!meta.cwd) continue
      const cwd = meta.cwd
      if (lastSeen.get(tabKey) === cwd) continue
      lastSeen.set(tabKey, cwd)
      const prev = timers.get(tabKey)
      if (prev) clearTimeout(prev)
      timers.set(
        tabKey,
        setTimeout(() => {
          timers.delete(tabKey)
          updateTabCwd(tabKey, cwd)
        }, DEBOUNCE_MS),
      )
    }
  })
}
