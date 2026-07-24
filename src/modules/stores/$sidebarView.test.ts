import { beforeEach, describe, expect, test } from 'bun:test'
import {
  $sidebarView,
  initSidebarViewFromStorage,
  setSidebarView,
} from '@/modules/stores/$sidebarView'

const KEY = 'agent-terminal:sidebar-view'

function installLocalStorage() {
  const store = new Map<string, string>()
  ;(globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage
  return store
}

describe('$sidebarView', () => {
  let ls: Map<string, string>
  beforeEach(() => {
    ls = installLocalStorage()
    $sidebarView.set('workspaces')
  })

  test('defaults to workspaces when nothing is stored', () => {
    initSidebarViewFromStorage()
    expect($sidebarView.get()).toBe('workspaces')
  })

  test('hydrates a stored recent value', () => {
    ls.set(KEY, 'recent')
    initSidebarViewFromStorage()
    expect($sidebarView.get()).toBe('recent')
  })

  test('ignores a garbage stored value and leaves the atom untouched', () => {
    ls.set(KEY, 'something-else')
    $sidebarView.set('recent')
    initSidebarViewFromStorage()
    expect($sidebarView.get()).toBe('recent')
  })

  test('setSidebarView writes through to localStorage', () => {
    setSidebarView('recent')
    expect($sidebarView.get()).toBe('recent')
    expect(ls.get(KEY)).toBe('recent')
    setSidebarView('workspaces')
    expect(ls.get(KEY)).toBe('workspaces')
  })
})
