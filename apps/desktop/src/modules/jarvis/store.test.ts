import { beforeEach, expect, test } from 'bun:test'
import { $jarvis, acceptSnapshot, openJarvis } from './store'
import type { UsageSnapshot } from './types'

function snapshot(revision: number, enabled = true): UsageSnapshot {
  return {
    revision,
    preferences: {
      enabled,
      showTray: false,
      refreshSeconds: 300,
      providers: [],
    },
    providers: [],
    refreshing: false,
    traySupported: true,
    claudeKeychainSupported: false,
    trayError: null,
    settingsError: null,
  }
}

beforeEach(() => {
  $jarvis.set({
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
  expect($jarvis.get().snapshot?.revision).toBe(4)
  expect($jarvis.get().snapshot?.preferences.enabled).toBe(true)
  expect($jarvis.get().loading).toBe(false)
})

test('first-use entry opens settings and native settings actions keep their destination', () => {
  acceptSnapshot(snapshot(1, false))
  openJarvis()
  expect($jarvis.get().view).toBe('settings')
  acceptSnapshot(snapshot(2))
  openJarvis()
  expect($jarvis.get().view).toBe('usage')
  openJarvis('settings')
  expect($jarvis.get().open).toBe(true)
  expect($jarvis.get().view).toBe('settings')
})
