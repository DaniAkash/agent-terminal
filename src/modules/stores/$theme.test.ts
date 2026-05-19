import { beforeEach, describe, expect, test } from 'bun:test'
import {
  $theme,
  applyThemeToDocument,
  getEffectiveTheme,
  initThemeFromStorage,
  setTheme,
} from '@/modules/stores/$theme'

function installDomStubs() {
  const attributes = new Map<string, string>()
  const docEl = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value)
    },
    removeAttribute: (_name: string) => {
      // applyThemeToDocument now always sets, never removes
    },
  } as unknown as HTMLElement

  ;(
    globalThis as typeof globalThis & {
      document: Document
      localStorage: Storage
      window: Window
    }
  ).document = {
    documentElement: docEl,
  } as Document

  ;(
    globalThis as typeof globalThis & {
      localStorage: Storage
    }
  ).localStorage = {
    getItem: (key: string) => attributes.get(`ls:${key}`) ?? null,
    setItem: (key: string, value: string) => {
      attributes.set(`ls:${key}`, value)
    },
    removeItem: (key: string) => {
      attributes.delete(`ls:${key}`)
    },
    clear: () => {
      for (const key of [...attributes.keys()]) {
        if (key.startsWith('ls:')) attributes.delete(key)
      }
    },
    key: () => null,
    length: 0,
  } as Storage

  ;(
    globalThis as typeof globalThis & {
      window: Window
    }
  ).window = {
    matchMedia: () =>
      ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as MediaQueryList,
    dispatchEvent: () => true,
  } as Window & { dispatchEvent: () => boolean }

  return { attributes }
}

beforeEach(() => {
  $theme.set('system')
  installDomStubs()
})

describe('theme store', () => {
  test('setTheme persists explicit dark and sets data-theme on document', () => {
    setTheme('dark')

    expect($theme.get()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('agent-terminal:theme')).toBe('dark')
  })

  test('setTheme system removes persisted key and resolves data-theme via OS', () => {
    setTheme('system')

    expect($theme.get()).toBe('system')
    // system + OS light → resolved "light" on document
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('agent-terminal:theme')).toBeNull()
  })

  test('initThemeFromStorage restores saved theme and applies to document', () => {
    localStorage.setItem('agent-terminal:theme', 'light')

    initThemeFromStorage()

    expect($theme.get()).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  test('initThemeFromStorage migrates legacy key', () => {
    localStorage.setItem('theme', 'dark')

    initThemeFromStorage()

    expect($theme.get()).toBe('dark')
    expect(localStorage.getItem('agent-terminal:theme')).toBe('dark')
    expect(localStorage.getItem('theme')).toBeNull()
  })

  test('applyThemeToDocument resolves system to concrete value', () => {
    applyThemeToDocument('system')

    // OS is light in stub, so resolved = "light"
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  test('getEffectiveTheme returns concrete value for explicit themes', () => {
    expect(getEffectiveTheme('dark')).toBe('dark')
    expect(getEffectiveTheme('light')).toBe('light')
  })

  test('getEffectiveTheme resolves system via matchMedia', () => {
    expect(getEffectiveTheme('system')).toBe('light')
  })
})
