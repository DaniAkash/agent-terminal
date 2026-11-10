import { beforeEach, expect, test } from 'bun:test'
import { $agentUsage, acceptSnapshot, openAgentUsage } from './store'
import type { UsageSnapshot } from './types'

function snapshot(revision: number, enabled = true): UsageSnapshot {
  return {
    revision,
    preferences: {
      enabled,
      refreshSeconds: 300,
      providers: [],
    },
    providers: [],
    refreshing: false,
    claudeKeychainSupported: false,
    settingsError: null,
  }
}

beforeEach(() => {
  $agentUsage.set({
    snapshot: null,
    loading: true,
    open: false,
    view: 'usage',
    saving: false,
    authorizing: false,
    error: null,
  })
})

test('a late snapshot response cannot overwrite a newer provider event', () => {
  acceptSnapshot(snapshot(4))
  acceptSnapshot(snapshot(2, false))
  expect($agentUsage.get().snapshot?.revision).toBe(4)
  expect($agentUsage.get().snapshot?.preferences.enabled).toBe(true)
  expect($agentUsage.get().loading).toBe(false)
})

test('first-use entry opens settings and explicit settings actions keep their destination', () => {
  acceptSnapshot(snapshot(1, false))
  openAgentUsage()
  expect($agentUsage.get().view).toBe('settings')
  acceptSnapshot(snapshot(2))
  openAgentUsage()
  expect($agentUsage.get().view).toBe('usage')
  openAgentUsage('settings')
  expect($agentUsage.get().open).toBe(true)
  expect($agentUsage.get().view).toBe('settings')
})
