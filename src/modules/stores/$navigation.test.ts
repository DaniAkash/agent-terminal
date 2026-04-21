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
  initNavigation,
  navigateToProject,
  navigateToTab,
  onTabRemoved,
} from '@/modules/stores/$navigation'
import { $projects, addTab, removeTab } from '@/modules/stores/$projects'
import { SEED_PROJECTS } from '@/screens/workspace/workspace.helpers'

beforeEach(() => {
  $projects.set(structuredClone(SEED_PROJECTS))
  $activeProjectId.set('')
  $activeTabId.set({})
})

/* ---------------------------------------------------------------------------
 * initNavigation()
 * -------------------------------------------------------------------------*/
describe('initNavigation()', () => {
  test('1: selects first project and first tab when projects exist', () => {
    initNavigation()
    expect($activeProjectId.get()).toBe('claude-ui')
    expect($activeTabId.get()['claude-ui']).toBe('dev')
  })

  test('2: does nothing when projects list is empty', () => {
    $projects.set([])
    initNavigation()
    expect($activeProjectId.get()).toBe('')
    expect($activeTabId.get()).toEqual({})
  })

  test('3: sets project id but empty tab id when first project has no tabs', () => {
    $projects.set([
      { id: 'empty', name: 'empty', path: '~', tabs: [], pinned: false },
    ])
    initNavigation()
    expect($activeProjectId.get()).toBe('empty')
    expect($activeTabId.get().empty).toBe('')
  })

  test('4: idempotent — calling twice does not crash and sets same state', () => {
    initNavigation()
    initNavigation()
    expect($activeProjectId.get()).toBe('claude-ui')
    expect($activeTabId.get()['claude-ui']).toBe('dev')
  })
})

/* ---------------------------------------------------------------------------
 * navigateToProject()
 * -------------------------------------------------------------------------*/
describe('navigateToProject()', () => {
  test('5: selects first tab when project has never been visited', () => {
    navigateToProject('api-service')
    expect($activeProjectId.get()).toBe('api-service')
    expect($activeTabId.get()['api-service']).toBe('dev')
  })

  test('6: preserves remembered tab when project was previously visited', () => {
    navigateToTab('api-service', 'db')
    navigateToProject('claude-ui')
    navigateToProject('api-service')
    expect($activeProjectId.get()).toBe('api-service')
    expect($activeTabId.get()['api-service']).toBe('db')
  })

  test('7: does not set tab id when project has no tabs', () => {
    $projects.set([
      ...SEED_PROJECTS,
      { id: 'empty', name: 'empty', path: '~', tabs: [], pinned: false },
    ])
    navigateToProject('empty')
    expect($activeProjectId.get()).toBe('empty')
    expect($activeTabId.get().empty).toBeUndefined()
  })

  test('8: accepts non-existent projectId — sets project id, leaves tab map unchanged', () => {
    navigateToProject('nonexistent')
    expect($activeProjectId.get()).toBe('nonexistent')
    expect($activeTabId.get()).toEqual({})
  })

  test('9: idempotent — navigating to already-active project leaves tab unchanged', () => {
    navigateToTab('claude-ui', 'server')
    navigateToProject('claude-ui')
    expect($activeProjectId.get()).toBe('claude-ui')
    expect($activeTabId.get()['claude-ui']).toBe('server')
  })
})

/* ---------------------------------------------------------------------------
 * navigateToTab()
 * -------------------------------------------------------------------------*/
describe('navigateToTab()', () => {
  test('10: switches tab within the current active project', () => {
    navigateToTab('claude-ui', 'dev')
    navigateToTab('claude-ui', 'git')
    expect($activeProjectId.get()).toBe('claude-ui')
    expect($activeTabId.get()['claude-ui']).toBe('git')
  })

  test('11: switches tab and project simultaneously', () => {
    navigateToTab('claude-ui', 'dev')
    navigateToTab('api-service', 'db')
    expect($activeProjectId.get()).toBe('api-service')
    expect($activeTabId.get()['api-service']).toBe('db')
  })

  test('12: creates new entry for project not yet in tab map', () => {
    navigateToTab('dotfiles', 'shell')
    expect($activeTabId.get().dotfiles).toBe('shell')
  })

  test('13: accepts any tabId string without validation — no crash', () => {
    navigateToTab('claude-ui', 'nonexistent-tab')
    expect($activeProjectId.get()).toBe('claude-ui')
    expect($activeTabId.get()['claude-ui']).toBe('nonexistent-tab')
  })
})

/* ---------------------------------------------------------------------------
 * onTabRemoved()
 * -------------------------------------------------------------------------*/
describe('onTabRemoved()', () => {
  test('14: non-active tab removed — active tab unchanged', () => {
    navigateToTab('claude-ui', 'dev')
    onTabRemoved('claude-ui', 'git')
    expect($activeTabId.get()['claude-ui']).toBe('dev')
  })

  test('15: active tab removed, not first — switches to the tab before it', () => {
    // SEED claude-ui tabs: [dev(0), server(1), git(2), repl(3)]
    navigateToTab('claude-ui', 'git') // idx 2
    onTabRemoved('claude-ui', 'git')
    // remaining: [dev, server, repl], idx 2, Math.max(0, 2-1) = 1 → server
    expect($activeTabId.get()['claude-ui']).toBe('server')
  })

  test('16: active tab removed, is first — switches to first remaining tab', () => {
    navigateToTab('claude-ui', 'dev') // idx 0
    onTabRemoved('claude-ui', 'dev')
    // remaining: [server, git, repl], idx 0, Math.max(0, 0-1) = 0 → server
    expect($activeTabId.get()['claude-ui']).toBe('server')
  })

  test('17: active tab removed, was the only tab — sets empty string', () => {
    $projects.set([
      {
        id: 'solo',
        name: 'solo',
        path: '~',
        pinned: false,
        tabs: [{ id: 'only', label: 'only', cmd: '', pinned: false }],
      },
    ])
    navigateToTab('solo', 'only')
    onTabRemoved('solo', 'only')
    expect($activeTabId.get().solo).toBe('')
  })

  test('18: projectId not in $projects — no crash, tab map unchanged', () => {
    navigateToTab('claude-ui', 'dev')
    onTabRemoved('ghost-project', 'some-tab')
    expect($activeTabId.get()['claude-ui']).toBe('dev')
  })

  test('19: removed tab in non-active project — that project tab updates, active project unchanged', () => {
    // Set up: claude-ui active, api-service has 'dev' as remembered tab
    navigateToTab('api-service', 'dev')
    $activeProjectId.set('claude-ui')
    // Remove 'dev' from api-service (not the active project)
    onTabRemoved('api-service', 'dev')
    // api-service: tabs [dev(0), db(1), logs(2)], remaining [db, logs], idx 0, pick db
    expect($activeTabId.get()['api-service']).toBe('db')
    expect($activeProjectId.get()).toBe('claude-ui')
  })
})

/* ---------------------------------------------------------------------------
 * Integration: addTab + onTabRemoved + removeTab
 * -------------------------------------------------------------------------*/
describe('addTab + onTabRemoved integration', () => {
  test('20: add tab, navigate to it, remove it — falls back to previous tab', () => {
    // claude-ui: [dev, server, git, repl]
    navigateToTab('claude-ui', 'repl') // set known state
    const newTab = addTab('claude-ui')
    if (!newTab) throw new Error('addTab returned null')
    // claude-ui: [dev, server, git, repl, newTab] — newTab at idx 4
    navigateToTab('claude-ui', newTab.id)
    onTabRemoved('claude-ui', newTab.id) // idx 4, remaining [dev,server,git,repl], pick idx 3 → repl
    removeTab('claude-ui', newTab.id)
    expect($activeTabId.get()['claude-ui']).toBe('repl')
  })

  test('21: multiple projects remember their own active tabs independently', () => {
    navigateToTab('claude-ui', 'git')
    navigateToTab('api-service', 'logs')
    navigateToTab('dotfiles', 'shell')
    expect($activeTabId.get()['claude-ui']).toBe('git')
    expect($activeTabId.get()['api-service']).toBe('logs')
    expect($activeTabId.get().dotfiles).toBe('shell')
  })

  test('22: remove all tabs of a project one by one — each removal updates correctly', () => {
    // dotfiles starts with [shell]
    const tab2 = addTab('dotfiles') // shell 2
    const tab3 = addTab('dotfiles') // shell 3
    if (!tab2 || !tab3) throw new Error('addTab returned null')
    // dotfiles: [shell, tab2, tab3]

    navigateToTab('dotfiles', 'shell')

    // Remove tab2 (not active) — no change to active tab
    onTabRemoved('dotfiles', tab2.id)
    removeTab('dotfiles', tab2.id)
    expect($activeTabId.get().dotfiles).toBe('shell')

    // dotfiles: [shell, tab3]. Navigate to tab3, remove it → back to shell
    navigateToTab('dotfiles', tab3.id)
    onTabRemoved('dotfiles', tab3.id) // idx 1, remaining [shell], pick idx 0 → shell
    removeTab('dotfiles', tab3.id)
    expect($activeTabId.get().dotfiles).toBe('shell')

    // dotfiles: [shell]. Remove last tab → empty string
    navigateToTab('dotfiles', 'shell')
    onTabRemoved('dotfiles', 'shell') // only tab → ''
    removeTab('dotfiles', 'shell')
    expect($activeTabId.get().dotfiles).toBe('')
  })
})
