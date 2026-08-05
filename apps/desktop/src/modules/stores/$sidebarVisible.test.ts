import { beforeEach, describe, expect, test } from 'bun:test'
import {
  $sidebarVisible,
  initSidebarVisibleFromStorage,
  setSidebarVisible,
  toggleSidebarVisible,
} from '@/modules/stores/$sidebarVisible'

const KEY = 'agent-terminal:sidebar-visible'

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

describe('$sidebarVisible', () => {
  let ls: Map<string, string>
  beforeEach(() => {
    ls = installLocalStorage()
    $sidebarVisible.set(true) // reset to default before each test
  })

  test('defaults to true when nothing is stored', () => {
    initSidebarVisibleFromStorage()
    expect($sidebarVisible.get()).toBe(true)
  })

  test('hydrates from a stored "false"', () => {
    ls.set(KEY, 'false')
    initSidebarVisibleFromStorage()
    expect($sidebarVisible.get()).toBe(false)
  })

  test('hydrates from a stored "true"', () => {
    ls.set(KEY, 'true')
    $sidebarVisible.set(false)
    initSidebarVisibleFromStorage()
    expect($sidebarVisible.get()).toBe(true)
  })

  test('ignores a garbage stored value and leaves the atom untouched', () => {
    ls.set(KEY, 'maybe')
    $sidebarVisible.set(false)
    initSidebarVisibleFromStorage()
    expect($sidebarVisible.get()).toBe(false)
  })

  test('setSidebarVisible writes through to localStorage', () => {
    setSidebarVisible(false)
    expect($sidebarVisible.get()).toBe(false)
    expect(ls.get(KEY)).toBe('false')
    setSidebarVisible(true)
    expect(ls.get(KEY)).toBe('true')
  })

  test('toggleSidebarVisible flips and persists both ways', () => {
    $sidebarVisible.set(true)
    toggleSidebarVisible()
    expect($sidebarVisible.get()).toBe(false)
    expect(ls.get(KEY)).toBe('false')
    toggleSidebarVisible()
    expect($sidebarVisible.get()).toBe(true)
    expect(ls.get(KEY)).toBe('true')
  })
})
