import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { map } from 'nanostores'
import { AgentUsageIPC } from './api'
import type { AgentUsagePreferences, UsageSnapshot } from './types'

interface AgentUsageState {
  snapshot: UsageSnapshot | null
  open: boolean
  view: 'usage' | 'settings'
  loading: boolean
  saving: boolean
  authorizing: boolean
  error: string | null
}

export const $agentUsage = map<AgentUsageState>({
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
  const current = $agentUsage.get().snapshot
  // A snapshot command may finish after a newer push event.
  if (current && snapshot.revision < current.revision) return
  $agentUsage.setKey('snapshot', snapshot)
  $agentUsage.setKey('loading', false)
}

export function openAgentUsage(view?: AgentUsageState['view']) {
  $agentUsage.setKey(
    'view',
    view ??
      ($agentUsage.get().snapshot?.preferences.enabled ? 'usage' : 'settings'),
  )
  $agentUsage.setKey('open', true)
}

export function startAgentUsage(): Promise<void> {
  if (initialization) return initialization
  const active = ++lifecycle
  initialization = initialize(active)
  return initialization
}

async function initialize(active: number) {
  $agentUsage.setKey('loading', true)
  $agentUsage.setKey('error', null)
  const installed: UnlistenFn[] = []
  try {
    installed.push(
      await listen<UsageSnapshot>('usage:updated', (event) => {
        if (lifecycle === active) acceptSnapshot(event.payload)
      }),
    )
    if (lifecycle !== active) return
    disposers = installed
    const snapshot = await AgentUsageIPC.snapshot()
    if (lifecycle === active) acceptSnapshot(snapshot)
  } catch {
    if (lifecycle !== active) return
    for (const dispose of installed) dispose()
    disposers = []
    initialization = undefined
    $agentUsage.setKey(
      'error',
      'Agent Usage limits could not connect to the usage service.',
    )
    $agentUsage.setKey('loading', false)
  } finally {
    if (lifecycle !== active) {
      for (const dispose of installed) dispose()
    }
  }
}

export async function saveAgentUsagePreferences(
  patch: Partial<AgentUsagePreferences>,
) {
  const state = $agentUsage.get()
  if (!state.snapshot || state.saving) return
  $agentUsage.setKey('saving', true)
  $agentUsage.setKey('error', null)
  try {
    acceptSnapshot(
      await AgentUsageIPC.setPreferences({
        ...state.snapshot.preferences,
        ...patch,
      }),
    )
  } catch (error) {
    $agentUsage.setKey('error', String(error))
  } finally {
    $agentUsage.setKey('saving', false)
  }
}

export async function authorizeClaudeKeychain() {
  if ($agentUsage.get().authorizing) return
  $agentUsage.setKey('authorizing', true)
  $agentUsage.setKey('error', null)
  try {
    await AgentUsageIPC.authorizeClaudeKeychain()
  } catch (error) {
    $agentUsage.setKey('error', String(error))
  } finally {
    $agentUsage.setKey('authorizing', false)
  }
}

export async function refreshAgentUsage() {
  $agentUsage.setKey('error', null)
  try {
    await AgentUsageIPC.refresh()
  } catch {
    $agentUsage.setKey('error', 'Could not refresh usage. Try again.')
  }
}

export function stopAgentUsage() {
  lifecycle++
  for (const dispose of disposers) dispose()
  disposers = []
  initialization = undefined
}

if (import.meta.hot) import.meta.hot.dispose(stopAgentUsage)
