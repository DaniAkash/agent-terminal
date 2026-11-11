import { invoke } from '@tauri-apps/api/core'

/** Request a confirmed application exit through the native event loop. */
export function quitApp(): Promise<void> {
  return invoke('quit_app')
}
