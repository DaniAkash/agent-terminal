import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { $hasCheckedThisSession } from '@/modules/updater/$updater'
import { checkForUpdate } from '@/modules/updater/checkForUpdate'

/**
 * Wires the renderer side of the updater flow once per app session:
 * one deferred startup check (silent on failure) and a listener for
 * the "Check for Updates…" menu item event.
 */
export function useUpdaterWiring(): void {
  useEffect(() => {
    if ($hasCheckedThisSession.get()) return
    $hasCheckedThisSession.set(true)
    // Defer past the launch sequence so PTY spawn / mod init isn't
    // sharing the event loop with a network round-trip.
    const t = setTimeout(() => {
      // Both flags silent: the cold-launch check should be invisible
      // unless there's an actionable result. Without `silentOnUpToDate`,
      // every launch with no update available would surface a "You're
      // up to date" toast — the common case on most launches.
      checkForUpdate({ silentOnFailure: true, silentOnUpToDate: true })
    }, 3000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const unlistenPromise = listen('menu:check-for-updates', () => {
      checkForUpdate({ silentOnFailure: false })
    })
    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {})
    }
  }, [])
}
