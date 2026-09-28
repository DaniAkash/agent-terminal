import { beforeEach, describe, expect, test } from 'bun:test'
import {
  $sidebarMaxWidth,
  $sidebarWidth,
  clampSidebarWidth,
  initSidebarWidthFromStorage,
  resetSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  setSidebarWidth,
  sidebarMaxForViewport,
} from '@/modules/stores/$sidebarWidth'

const KEY = 'agent-terminal:sidebar-width'

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

describe('clampSidebarWidth', () => {
  test('passes a width inside the range through', () => {
    expect(clampSidebarWidth(300)).toBe(300)
  })

  test('clamps below the minimum', () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_WIDTH_MIN)
  })

  test('clamps above the maximum', () => {
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_WIDTH_MAX)
  })

  test('honours a lower ceiling supplied by the caller', () => {
    expect(clampSidebarWidth(400, 300)).toBe(300)
  })

  test('keeps the minimum when the supplied ceiling is below it', () => {
    // A very narrow window must not invert the range.
    expect(clampSidebarWidth(400, 50)).toBe(SIDEBAR_WIDTH_MIN)
  })

  test('falls back to the default on a non-finite width', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  test('rounds fractional widths', () => {
    expect(clampSidebarWidth(300.6)).toBe(301)
  })
})

describe('sidebarMaxForViewport', () => {
  test('caps the sidebar to a share of a narrow window', () => {
    expect(sidebarMaxForViewport(800)).toBe(320)
  })

  test('never exceeds the absolute maximum on a wide window', () => {
    expect(sidebarMaxForViewport(4000)).toBe(SIDEBAR_WIDTH_MAX)
  })

  test('never drops below the minimum on a tiny window', () => {
    expect(sidebarMaxForViewport(200)).toBe(SIDEBAR_WIDTH_MIN)
  })
})

describe('$sidebarWidth', () => {
  let ls: Map<string, string>
  beforeEach(() => {
    ls = installLocalStorage()
    $sidebarWidth.set(SIDEBAR_WIDTH_DEFAULT)
  })

  test('defaults when nothing is stored', () => {
    initSidebarWidthFromStorage()
    expect($sidebarWidth.get()).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  test('hydrates a stored width', () => {
    ls.set(KEY, '300')
    initSidebarWidthFromStorage()
    expect($sidebarWidth.get()).toBe(300)
  })

  test('clamps a stored width that is too large', () => {
    // e.g. saved on a wide external display, reopened on a laptop.
    ls.set(KEY, '9999')
    initSidebarWidthFromStorage()
    expect($sidebarWidth.get()).toBeLessThanOrEqual(SIDEBAR_WIDTH_MAX)
    expect($sidebarWidth.get()).toBeGreaterThanOrEqual(SIDEBAR_WIDTH_MIN)
  })

  test('keeps the default when the stored value is malformed', () => {
    ls.set(KEY, 'not-a-number')
    initSidebarWidthFromStorage()
    expect($sidebarWidth.get()).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  test('setSidebarWidth persists and clamps', () => {
    setSidebarWidth(9999)
    expect($sidebarWidth.get()).toBe(SIDEBAR_WIDTH_MAX)
    expect(ls.get(KEY)).toBe(String(SIDEBAR_WIDTH_MAX))
  })

  test('exposes the viewport-narrowed ceiling for assistive tech', () => {
    // The handle reports this as aria-valuemax. A hardcoded absolute maximum
    // would promise a width the drag then refuses on a narrow window.
    const g = globalThis as typeof globalThis & {
      window?: { innerWidth: number }
    }
    const prev = g.window
    g.window = { innerWidth: 900 }
    try {
      setSidebarWidth(400)
      expect($sidebarMaxWidth.get()).toBe(sidebarMaxForViewport(900))
      expect($sidebarWidth.get()).toBe(sidebarMaxForViewport(900))
    } finally {
      g.window = prev
    }
  })

  test('resetSidebarWidth returns to the default', () => {
    setSidebarWidth(400)
    resetSidebarWidth()
    expect($sidebarWidth.get()).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(ls.get(KEY)).toBe(String(SIDEBAR_WIDTH_DEFAULT))
  })
})
