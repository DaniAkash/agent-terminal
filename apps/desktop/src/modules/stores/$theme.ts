import { atom } from 'nanostores'

export type Theme = 'light' | 'dark' | 'system'

const KEY = 'agent-terminal:theme'
const LEGACY_KEY = 'theme'

export const $theme = atom<Theme>('system')

function resolveSystemTheme(): 'light' | 'dark' {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

// Module refs for the OS-preference listener — kept so the subscription
// can be torn down (test teardown, hot reload) and so re-calling
// initThemeFromStorage doesn't stack listeners.
let systemMq: MediaQueryList | null = null
let systemListener: ((e: MediaQueryListEvent) => void) | null = null

/**
 * Wires an OS prefers-color-scheme listener that re-applies the theme
 * whenever the current selection is 'system'. Safe to call multiple
 * times: each call disposes the prior subscription first and re-binds
 * to the current `window.matchMedia` instance. Without that, a fresh
 * `window` stub in tests (or a hot-reload-replaced MediaQueryList)
 * would leave us holding a dead reference.
 *
 * Guarded for runtimes that define `window` but not `matchMedia`
 * (bun:test, jsdom-minimal, partial SSR), which is also why this lives
 * in a function rather than at module top-level — running on import
 * threw in CI.
 */
function subscribeSystemThemeChanges() {
  disposeThemeSubscriptions()
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return
  }
  systemMq = window.matchMedia('(prefers-color-scheme: dark)')
  systemListener = () => {
    if ($theme.get() === 'system') applyThemeToDocument('system')
  }
  systemMq.addEventListener('change', systemListener)
}

/** Removes the OS prefers-color-scheme listener. No-op if not subscribed. */
export function disposeThemeSubscriptions() {
  if (systemMq && systemListener) {
    systemMq.removeEventListener('change', systemListener)
  }
  systemMq = null
  systemListener = null
}

function migrateLegacyKey() {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy === 'light' || legacy === 'dark') {
      if (localStorage.getItem(KEY) === null) {
        localStorage.setItem(KEY, legacy)
      }
      localStorage.removeItem(LEGACY_KEY)
    }
  } catch {}
}

export function initThemeFromStorage() {
  migrateLegacyKey()
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') {
      $theme.set(v)
    }
  } catch {}
  applyThemeToDocument($theme.get())
  subscribeSystemThemeChanges()
}

export function setTheme(t: Theme) {
  try {
    if (t === 'system') {
      localStorage.removeItem(KEY)
    } else {
      localStorage.setItem(KEY, t)
    }
  } catch {}
  $theme.set(t)
  applyThemeToDocument(t)
}

export function applyThemeToDocument(t: Theme) {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  const resolved = t === 'system' ? resolveSystemTheme() : t
  // Short-circuit on no-op writes — setAttribute still fires a
  // MutationRecord even when the value is unchanged, and every mounted
  // xterm's MutationObserver would then call term.refresh for nothing.
  if (html.getAttribute('data-theme') === resolved) return
  html.setAttribute('data-theme', resolved)
}

export function getEffectiveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'dark' || t === 'light') return t
  if (typeof window === 'undefined') return 'light'
  return resolveSystemTheme()
}
