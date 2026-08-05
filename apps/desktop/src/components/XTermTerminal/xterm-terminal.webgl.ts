import type { WebglAddon } from '@xterm/addon-webgl'
import type { Terminal } from '@xterm/xterm'

export type WebglLifecycleDeps = {
  term: Terminal
  /**
   * Constructs and returns a fresh WebglAddon. Wrapping the constructor
   * lets tests inject a stub without touching the real WebGL stack.
   */
  createAddon: () => WebglAddon
  /**
   * Reads the live "should WebGL be active" answer at call time. Lets
   * the microtask-deferred retry bail out if the pane was deactivated
   * between context loss and retry firing.
   */
  isActive: () => boolean
  /**
   * Schedule a function to run after the current task. Defaults to
   * `queueMicrotask`; overridable so tests can flush deterministically.
   */
  scheduleRetry?: (fn: () => void) => void
  /**
   * Wall-clock-ish source for the retry-window check. Defaults to
   * `performance.now()`; overridable so tests can advance virtual time.
   */
  now?: () => number
}

export type WebglLifecycle = {
  enableWebgl: () => void
  disableWebgl: () => void
  /** True iff a WebglAddon is currently loaded on the terminal. */
  isEnabled: () => boolean
  /** Tear-down for unmount — disposes any live addon without refresh. */
  dispose: () => void
}

/**
 * Manages a single WebglAddon's lifecycle on a Terminal instance and
 * guarantees `term.refresh` is called on every renderer transition.
 *
 * Behaviour contracts:
 *   - enableWebgl() is idempotent — calling while already enabled is a
 *     no-op (no extra addon allocated, no extra refresh).
 *   - disableWebgl() refreshes the visible buffer once so the DOM
 *     renderer that takes over (via WebglAddon.dispose() reinstalling
 *     it) repaints what's actually in the buffer, instead of leaving
 *     the stale WebGL canvas content visible.
 *   - On context loss: dispose + refresh, then attempt ONE retry via
 *     the scheduler. A second loss within the retry window (default
 *     5 s) suppresses the retry — bounded so a persistently broken
 *     GPU doesn't thrash the addon lifecycle.
 *   - Retries no-op if `isActive()` is false at retry time — when the
 *     pane has been deactivated between loss and retry, the disable
 *     path already ran and we don't want to re-enable.
 */
const CONTEXT_LOSS_RETRY_WINDOW_MS = 5000

export function createWebglLifecycle(deps: WebglLifecycleDeps): WebglLifecycle {
  const scheduleRetry = deps.scheduleRetry ?? queueMicrotask
  const now = deps.now ?? (() => performance.now())

  let webglAddon: WebglAddon | null = null
  let lastContextLossAt = -Infinity
  let disposed = false

  function refreshVisible() {
    const term = deps.term
    if (term.rows <= 0) return
    term.refresh(0, term.rows - 1)
  }

  function onContextLossOf(addon: WebglAddon) {
    return () => {
      // Always dispose + refresh so the DOM renderer that WebglAddon's
      // dispose path installs gets explicitly told to paint the buffer.
      // Without this, the pane shows whatever stale frame the WebGL
      // canvas had at the moment of loss.
      addon.dispose()
      if (webglAddon === addon) webglAddon = null
      refreshVisible()

      // Bounded retry: if another loss happened within the window, give
      // up. Otherwise schedule a single retry via the injected scheduler
      // (microtask in prod, manual in tests).
      const t = now()
      const recent = t - lastContextLossAt < CONTEXT_LOSS_RETRY_WINDOW_MS
      lastContextLossAt = t
      if (recent) return
      scheduleRetry(() => {
        if (disposed) return
        if (!deps.isActive()) return
        enableWebgl()
      })
    }
  }

  function enableWebgl(): void {
    if (disposed) return
    if (webglAddon) return
    try {
      const addon = deps.createAddon()
      addon.onContextLoss(onContextLossOf(addon))
      deps.term.loadAddon(addon)
      webglAddon = addon
      refreshVisible()
    } catch {
      // WebGL2 not available — leave the DOM renderer in place. Future
      // enable attempts will retry naturally on next isActive flip.
      webglAddon = null
    }
  }

  function disableWebgl(): void {
    if (!webglAddon) return
    webglAddon.dispose()
    webglAddon = null
    refreshVisible()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    webglAddon?.dispose()
    webglAddon = null
  }

  function isEnabled(): boolean {
    return webglAddon !== null
  }

  return { enableWebgl, disableWebgl, dispose, isEnabled }
}
