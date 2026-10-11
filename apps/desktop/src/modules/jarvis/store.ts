import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { map } from 'nanostores'
import { JarvisIPC } from './api'
import type { JarvisPreferences, UsageSnapshot } from './types'

interface JarvisState {
  snapshot: UsageSnapshot | null
  open: boolean
  view: 'usage' | 'settings'
  loading: boolean
  saving: boolean
  authorizing: boolean
  error: string | null
}

export const $jarvis = map<JarvisState>({
  snapshot: null,
  open: false,
  view: 'usage',
  loading: true,
  saving: false,
  authorizing: false,
  error: null,
})

let disposers: UnlistenFn[] = []
let initialization: Promise<void> | undefined
let lifecycle = 0

export function acceptSnapshot(snapshot: UsageSnapshot) {
  const current = $jarvis.get().snapshot
  // A snapshot command may finish after a newer push event.
  if (current && snapshot.revision < current.revision) return
  $jarvis.setKey('snapshot', snapshot)
  $jarvis.setKey('loading', false)
}

export function openJarvis(view?: JarvisState['view']) {
  $jarvis.setKey(
    'view',
    view ??
      ($jarvis.get().snapshot?.preferences.enabled ? 'usage' : 'settings'),
  )
  $jarvis.setKey('open', true)
}

export function startJarvis(): Promise<void> {
  if (initialization) return initialization
  const active = ++lifecycle
  initialization = initialize(active)
  return initialization
}

async function initialize(active: number) {
  $jarvis.setKey('loading', true)
  $jarvis.setKey('error', null)
  const installed: UnlistenFn[] = []
  try {
    installed.push(
      await listen<UsageSnapshot>('jarvis:updated', (event) => {
        if (lifecycle === active) acceptSnapshot(event.payload)
      }),
    )
    installed.push(
      await listen<boolean>('jarvis:open', (event) => {
        if (lifecycle === active)
          openJarvis(event.payload ? 'settings' : 'usage')
      }),
    )
    if (lifecycle !== active) return
    disposers = installed
    const snapshot = await JarvisIPC.snapshot()
    if (lifecycle === active) acceptSnapshot(snapshot)
  } catch {
    if (lifecycle !== active) return
    for (const dispose of installed) dispose()
    disposers = []
    initialization = undefined
    $jarvis.setKey('error', 'Jarvis could not connect to the usage service.')
    $jarvis.setKey('loading', false)
  } finally {
    if (lifecycle !== active) {
      for (const dispose of installed) dispose()
    }
  }
}

export async function saveJarvisPreferences(patch: Partial<JarvisPreferences>) {
  const state = $jarvis.get()
  if (!state.snapshot || state.saving) return
  $jarvis.setKey('saving', true)
  $jarvis.setKey('error', null)
  try {
    acceptSnapshot(
      await JarvisIPC.setPreferences({
        ...state.snapshot.preferences,
        ...patch,
      }),
    )
  } catch (error) {
    $jarvis.setKey('error', String(error))
  } finally {
    $jarvis.setKey('saving', false)
  }
}

export async function authorizeClaudeKeychain() {
  if ($jarvis.get().authorizing) return
  $jarvis.setKey('authorizing', true)
  $jarvis.setKey('error', null)
  try {
    await JarvisIPC.authorizeClaudeKeychain()
  } catch (error) {
    $jarvis.setKey('error', String(error))
  } finally {
    $jarvis.setKey('authorizing', false)
  }
}

export async function refreshJarvis() {
  $jarvis.setKey('error', null)
  try {
    await JarvisIPC.refresh()
  } catch {
    $jarvis.setKey('error', 'Could not refresh usage. Try again.')
  }
}

export function stopJarvis() {
  lifecycle++
  for (const dispose of disposers) dispose()
  disposers = []
  initialization = undefined
}

if (import.meta.hot) import.meta.hot.dispose(stopJarvis)
