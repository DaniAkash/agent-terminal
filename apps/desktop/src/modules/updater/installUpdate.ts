import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { $updater } from '@/modules/updater/$updater'

/**
 * Download + install the pending update, then relaunch the app.
 *
 * The check() call is repeated here (rather than passed in from the
 * caller) because the Update object's downloadAndInstall is bound to a
 * specific check() invocation — passing it across a UI event would
 * require either captured state or a Promise lifetime that survives
 * the React render that triggered the call.
 */
export async function installUpdate(): Promise<void> {
  let update: Update | null
  try {
    update = await check()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    $updater.set({ kind: 'error', message })
    return
  }
  if (!update) {
    $updater.set({ kind: 'idle' })
    return
  }

  $updater.set({ kind: 'downloading', progress: 0 })

  let downloaded = 0
  let total = 0

  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? 0
          break
        case 'Progress':
          downloaded += event.data.chunkLength
          $updater.set({
            kind: 'downloading',
            progress: total > 0 ? downloaded / total : 0,
          })
          break
        case 'Finished':
          $updater.set({ kind: 'ready-to-install' })
          break
      }
    })
    await relaunch()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    $updater.set({ kind: 'error', message })
  }
}
