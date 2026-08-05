import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { $updater } from '@/modules/updater/$updater'

/**
 * Hit the updater endpoint and feed the result into `$updater`.
 *
 * Two independent suppression flags shape the startup-vs-manual UX:
 *
 * - `silentOnFailure` — startup check stays quiet when offline / endpoint
 *   down; manual check surfaces the error so the user knows their click
 *   did something.
 * - `silentOnUpToDate` — startup check stays quiet when there's nothing
 *   to install (the common case on every cold launch); manual check
 *   surfaces a "You're up to date (vX.Y.Z)" confirmation so the click
 *   has visible feedback.
 *
 * Both flags default to `false` so explicit/manual callers get loud
 * behaviour for both outcomes.
 */
export async function checkForUpdate(opts?: {
  silentOnFailure?: boolean
  silentOnUpToDate?: boolean
}): Promise<void> {
  $updater.set({ kind: 'checking' })
  try {
    const update = await check()
    if (!update) {
      if (opts?.silentOnUpToDate) {
        $updater.set({ kind: 'idle' })
        return
      }
      // Surface the currently-installed version so the menu-triggered
      // "you're up to date" toast can show what the user is on.
      const currentVersion = await getVersion()
      $updater.set({ kind: 'up-to-date', currentVersion })
      return
    }
    $updater.set({
      kind: 'available',
      version: update.version,
      notes: update.body ?? '',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (opts?.silentOnFailure) {
      // biome-ignore lint/suspicious/noConsole: silent-failure path needs a breadcrumb in devtools
      console.warn('[updater] check failed:', message)
      $updater.set({ kind: 'idle' })
      return
    }
    $updater.set({ kind: 'error', message })
  }
}
