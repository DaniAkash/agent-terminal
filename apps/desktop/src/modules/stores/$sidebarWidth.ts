import { atom } from 'nanostores'

/**
 * Sidebar width in pixels.
 *
 * Persisted to localStorage so the choice survives restarts, and mirrored
 * onto `--sidebar-width` at the document root, which is what `Sidebar`
 * actually renders against. `index.css` still declares the default so the
 * sidebar paints at a sane width before hydration runs.
 *
 * Follows the persistence pattern established by `$sidebarVisible`:
 *   - `initSidebarWidthFromStorage()` at app boot to hydrate.
 *   - `setSidebarWidth()` write-through.
 *
 * The CSS variable write lives in the store action rather than an effect,
 * so the DOM is updated by whatever caused the change instead of by a
 * render reacting to it afterwards.
 */
const KEY = 'agent-terminal:sidebar-width'

/** Matches the `--sidebar-width` default in index.css. */
export const SIDEBAR_WIDTH_DEFAULT = 232
/** Below this the longest project rows stop being readable. */
export const SIDEBAR_WIDTH_MIN = 180
/** Absolute ceiling, further limited by viewport on narrow windows. */
export const SIDEBAR_WIDTH_MAX = 480

/** Share of the window the sidebar may occupy before it crowds the terminal. */
const MAX_VIEWPORT_SHARE = 0.4

/**
 * Ceiling for a given window width. A fixed 480 would swallow a small
 * window, so the viewport share caps it, and MIN wins over both so the
 * range never inverts on a very narrow window.
 */
export function sidebarMaxForViewport(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return SIDEBAR_WIDTH_MAX
  }
  const share = Math.round(viewportWidth * MAX_VIEWPORT_SHARE)
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, share))
}

/** Non-finite input falls back to the default rather than propagating NaN. */
export function clampSidebarWidth(
  px: number,
  max: number = SIDEBAR_WIDTH_MAX,
): number {
  if (!Number.isFinite(px)) return SIDEBAR_WIDTH_DEFAULT
  const ceiling = Math.max(SIDEBAR_WIDTH_MIN, max)
  return Math.min(Math.max(Math.round(px), SIDEBAR_WIDTH_MIN), ceiling)
}

export const $sidebarWidth = atom<number>(SIDEBAR_WIDTH_DEFAULT)

function currentViewportMax(): number {
  return typeof window === 'undefined'
    ? SIDEBAR_WIDTH_MAX
    : sidebarMaxForViewport(window.innerWidth)
}

/**
 * No-op outside a real DOM so the store stays usable under `bun test`.
 * Checks the style object rather than just `document`, because the test
 * environment supplies a partial document with no documentElement.
 */
export function applySidebarWidthToDocument(px: number) {
  const root = typeof document === 'undefined' ? null : document.documentElement
  if (!root?.style) return
  root.style.setProperty('--sidebar-width', `${px}px`)
}

export function initSidebarWidthFromStorage() {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(KEY)
  } catch {}
  if (stored !== null) {
    const parsed = Number(stored)
    if (Number.isFinite(parsed)) {
      $sidebarWidth.set(clampSidebarWidth(parsed, currentViewportMax()))
    }
  }
  applySidebarWidthToDocument($sidebarWidth.get())
}

export function setSidebarWidth(px: number) {
  const next = clampSidebarWidth(px, currentViewportMax())
  try {
    localStorage.setItem(KEY, String(next))
  } catch {}
  $sidebarWidth.set(next)
  applySidebarWidthToDocument(next)
}

export function resetSidebarWidth() {
  setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
}

/**
 * Re-clamp after the window shrinks, so a width chosen on a wide display
 * cannot strand an oversized sidebar on a small one.
 */
export function clampSidebarWidthToViewport() {
  const current = $sidebarWidth.get()
  const next = clampSidebarWidth(current, currentViewportMax())
  if (next !== current) setSidebarWidth(next)
}
