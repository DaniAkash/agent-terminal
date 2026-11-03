import { check, type Update } from '@tauri-apps/plugin-updater'
import { $deferredUpdate, $updater } from '@/modules/updater/$updater'

/**
 * Download and stage the pending update, without taking the restart.
 *
 * Relaunching from inside the download meant an update could make the
 * app vanish while an agent was mid turn. Staging and stopping lets the
 * user pick the moment, and sends that choice through the same guard
 * that protects quitting.
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
          break
      }
    })
    $updater.set({ kind: 'ready-to-restart', version: update.version })
    $deferredUpdate.set({ version: update.version, staged: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    $updater.set({ kind: 'error', message })
  }
}
