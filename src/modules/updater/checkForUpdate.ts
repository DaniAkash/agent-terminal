import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { $updater } from '@/modules/updater/$updater'

/**
 * Hit the updater endpoint and feed the result into `$updater`.
 *
 * `silentOnFailure` controls the failure behaviour: silent on the
 * startup auto-check (so an offline user doesn't see a useless toast),
 * loud on manual menu-triggered checks (so the user knows their
 * intentional action did something).
 */
export async function checkForUpdate(opts?: {
  silentOnFailure?: boolean
}): Promise<void> {
  $updater.set({ kind: 'checking' })
  try {
    const update = await check()
    if (!update) {
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
