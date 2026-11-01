import { mock } from 'bun:test'

// Mock IPC before any store import so Tauri invoke() is never called.
mock.module('@/modules/ipc/commands', () => ({
  IPC: {
    saveProjects: mock(() => Promise.resolve()),
    closeTab: mock(() => Promise.resolve()),
    openTab: mock(() => Promise.resolve(true)),
    writePty: mock(() => Promise.resolve()),
    resizePty: mock(() => Promise.resolve()),
    listProjects: mock(() => Promise.resolve([])),
    syncProjectsToWss: mock(() => Promise.resolve()),
    reportMobileOpError: mock(() => Promise.resolve()),
    reportMobileOpOk: mock(() => Promise.resolve()),
  },
}))

import { beforeEach, describe, expect, test } from 'bun:test'
import { $activeTabId } from '@/modules/stores/$navigation'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { $interrupt, dismissInterrupt } from '@/modules/work/$interrupt'
import { confirmCloseTab, requestCloseTab } from '@/modules/work/close-tab'
import type { Project } from '@/screens/workspace/workspace.types'

const PROJECT: Project = {
  id: 'p1',
  name: 'control-center',
  path: '/p1',
  pinned: false,
  tabs: [
    { id: 't1', label: 'first', cmd: '', pinned: false },
    { id: 't2', label: 'busy', cmd: '', pinned: false },
  ],
}

function seed() {
  $projects.set([structuredClone(PROJECT)])
  $activeTabId.set({ p1: 't2' })
  $tabMeta.set({})
  dismissInterrupt()
}

const tabIds = () => $projects.get()[0]?.tabs.map((t) => t.id) ?? []

describe('requestCloseTab', () => {
  beforeEach(seed)

  test('closes an idle tab straight away', () => {
    requestCloseTab('p1', 't2')
    expect(tabIds()).toEqual(['t1'])
    expect($interrupt.get()).toBeNull()
  })

  test('asks instead of closing when the tab is busy', () => {
    $tabMeta.set({ 'p1:t2': { status: 'running', type: 'shell' } })
    requestCloseTab('p1', 't2')
    expect(tabIds()).toEqual(['t1', 't2'])
    expect($interrupt.get()).toEqual({
      kind: 'close-tab',
      projectId: 'p1',
      tabId: 't2',
    })
  })

  test('cancelling leaves the active tab alone', () => {
    // The side effects of closing (moving the active tab, dismissing the
    // tab's notification) used to run at the call site, before the
    // question was answered, so a cancel left the tab open but already
    // navigated away from.
    $tabMeta.set({ 'p1:t2': { status: 'running', type: 'shell' } })
    requestCloseTab('p1', 't2')
    dismissInterrupt()
    expect(tabIds()).toEqual(['t1', 't2'])
    expect($activeTabId.get().p1).toBe('t2')
  })

  test('confirming both closes the tab and moves off it', () => {
    $tabMeta.set({ 'p1:t2': { status: 'running', type: 'shell' } })
    requestCloseTab('p1', 't2')
    confirmCloseTab('p1', 't2')
    expect(tabIds()).toEqual(['t1'])
    expect($activeTabId.get().p1).toBe('t1')
  })

  test('closing an idle tab still moves off it', () => {
    requestCloseTab('p1', 't2')
    expect($activeTabId.get().p1).toBe('t1')
  })

  test('ignores a project that is gone', () => {
    requestCloseTab('nope', 't1')
    expect(tabIds()).toEqual(['t1', 't2'])
    expect($interrupt.get()).toBeNull()
  })
})
