import { atom } from 'nanostores'

export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'downloading'; progress: number }
  /** Downloaded and staged. The restart is the user's to make. */
  | { kind: 'ready-to-restart'; version: string }
  | { kind: 'error'; message: string }
  | { kind: 'up-to-date'; currentVersion: string }

export const $updater = atom<UpdaterState>({ kind: 'idle' })

// Sticky session flag so the launch auto-check fires exactly once per
// app process. Manual menu-triggered checks ignore it.
export const $hasCheckedThisSession = atom<boolean>(false)

/**
 * An update the user put off, kept so the status bar can offer it again.
 *
 * Dismissing used to set the state to idle, and because the launch check
 * is sticky for the process that meant Later never came back. Holding
 * the pending update here is what makes Later a deferral rather than an
 * erasure.
 */
export const $deferredUpdate = atom<{
  version: string
  staged: boolean
} | null>(null)

export function deferUpdate(version: string, staged: boolean): void {
  $deferredUpdate.set({ version, staged })
  $updater.set({ kind: 'idle' })
}

/** Put the deferred update back on screen, from the status bar. */
export function resumeDeferredUpdate(): void {
  const deferred = $deferredUpdate.get()
  if (!deferred) return
  $updater.set(
    deferred.staged
      ? { kind: 'ready-to-restart', version: deferred.version }
      : { kind: 'available', version: deferred.version, notes: '' },
  )
}
