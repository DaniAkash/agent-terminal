import { atom } from 'nanostores'

export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'downloading'; progress: number }
  | { kind: 'ready-to-install' }
  | { kind: 'error'; message: string }
  | { kind: 'up-to-date'; currentVersion: string }

export const $updater = atom<UpdaterState>({ kind: 'idle' })

// Sticky session flag so the launch auto-check fires exactly once per
// app process. Manual menu-triggered checks ignore it.
export const $hasCheckedThisSession = atom<boolean>(false)
