import { mock } from 'bun:test'

// Mock IPC before any store imports so Tauri invoke() is never called.
mock.module('@/modules/ipc/commands', () => ({
  IPC: {
    saveProjects: mock(() => Promise.resolve()),
    closeTab: mock(() => Promise.resolve()),
    openTab: mock(() => Promise.resolve(true)),
    writePty: mock(() => Promise.resolve()),
    resizePty: mock(() => Promise.resolve()),
    listProjects: mock(() => Promise.resolve([])),
  },
}))

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  $activeProjectId,
  $activeTabId,
  navigateToTab,
  openNewTabInProject,
} from '@/modules/stores/$navigation'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'
import type { Project } from '@/screens/workspace/workspace.types'

function singleTabProject(lastCwd?: string): Project[] {
  return [
    {
      id: 'p',
      name: 'p',
      path: '~/start',
      pinned: false,
      tabs: [{ id: 'a', label: 'a', cmd: '', pinned: false, lastCwd }],
    },
  ]
}

beforeEach(() => {
  $projects.set([])
  $activeProjectId.set('')
  $activeTabId.set({})
  $tabMeta.set({})
})

describe('openNewTabInProject() — cwd inheritance', () => {
  test('1: live $tabMeta cwd wins over persisted lastCwd on the source tab', () => {
    $projects.set(singleTabProject('/persisted'))
    navigateToTab('p', 'a')
    $tabMeta.set({
      [makeTabKey('p', 'a')]: { status: 'idle', type: 'shell', cwd: '/live' },
    })
    expect(openNewTabInProject('p')?.lastCwd).toBe('/live')
  })

  test('2: persisted lastCwd used when $tabMeta has no entry for the source tab', () => {
    $projects.set(singleTabProject('/persisted'))
    navigateToTab('p', 'a')
    expect(openNewTabInProject('p')?.lastCwd).toBe('/persisted')
  })

  test('3: stale $activeTabId (id not in project.tabs) falls back to tabs[0]', () => {
    $projects.set(singleTabProject('/from-a'))
    $activeTabId.set({ p: 'ghost' })
    expect(openNewTabInProject('p')?.lastCwd).toBe('/from-a')
  })

  test('4: no cwd anywhere → new tab has undefined lastCwd', () => {
    $projects.set(singleTabProject(undefined))
    expect(openNewTabInProject('p')?.lastCwd).toBeUndefined()
  })

  test('5: returns null for unknown projectId', () => {
    expect(openNewTabInProject('nonexistent')).toBeNull()
  })
})
