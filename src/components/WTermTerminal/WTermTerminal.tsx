import { WTerm } from '@wterm/dom'
import React, { useEffect, useRef } from 'react'

export type WTermHandle = {
  write: (data: string) => void
  focus: () => void
}

type Props = {
  onReady: (handle: WTermHandle) => void
  onData: (data: string) => void
  onResize: (cols: number, rows: number) => void
  className?: string
}

// Returns true when the key combo is claimed by the app's hotkey layer
// (react-hotkeys-hook at document level). Capture-phase listener on the host
// element calls stopImmediatePropagation() so wterm's internal textarea
// keydown handler never fires for these combos. The keydown still bubbles to
// document so react-hotkeys-hook picks it up.
//
// wterm has no `attachCustomKeyEventHandler` equivalent — this capture-phase
// listener is the replacement. Same behaviour, different mechanism.
function isAppShortcut(e: KeyboardEvent): boolean {
  if (!e.ctrlKey) return false
  return (
    e.key === 'Tab' || // Ctrl+Tab, Ctrl+Shift+Tab
    e.key === 't' ||
    e.key === 'T' || // Ctrl+T
    e.key === 'w' ||
    e.key === 'W' || // Ctrl+W
    '123456789'.includes(e.key) // Ctrl+1–9
  )
}

export const WTermTerminal = React.memo(function WTermTerminal({
  onReady,
  onData,
  onResize,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<WTerm | null>(null)

  // Stable refs so the mount-once effect always invokes the latest callbacks
  // without needing to re-run when their identities change.
  const onReadyRef = useRef(onReady)
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  useEffect(() => {
    onReadyRef.current = onReady
    onDataRef.current = onData
    onResizeRef.current = onResize
  }, [onReady, onData, onResize])

  useEffect(() => {
    const outer = containerRef.current
    if (!outer) return

    // Create a fresh inner host div per effect instance.
    //
    // wterm's destroy() runs `this.element.innerHTML = ""`, which clears all
    // children of the host element. In React StrictMode (and any other case
    // where two effect instances overlap during mount/unmount), Mount 1's
    // async init() can resolve AFTER Mount 2 has already constructed its own
    // WTerm on the same host — at which point Mount 1's destroy() clobbers
    // Mount 2's term-grid and input textarea, leaving Mount 2 rendering into
    // a detached DOM subtree (terminal stays blank).
    //
    // Giving each instance its own host (this `inner` div) isolates the
    // subtrees: Mount 1's destroy only operates on inner1, which by then has
    // already been removed from outer.
    const inner = document.createElement('div')
    inner.style.height = '100%'
    inner.style.width = '100%'
    // Override wterm's default "card" presentation — its CSS ships with
    // padding: 12px, border-radius: 8px, and a drop shadow that look out of
    // place when the terminal is embedded in a pane (the wterm-shipped React
    // demo overrides these the same way for embedded use).
    inner.style.padding = '0'
    inner.style.borderRadius = '0'
    inner.style.boxShadow = 'none'
    outer.appendChild(inner)

    let cancelled = false
    let term: WTerm | null = null

    // App-level shortcut interceptor — capture phase on the outer div so it
    // runs before wterm's textarea (deeper in the tree) handles the keydown.
    // stopImmediatePropagation prevents wterm from converting the keystroke
    // into PTY input. Intentionally NOT preventDefault — react-hotkeys-hook
    // still needs the event at the document level.
    //
    // wterm has no `attachCustomKeyEventHandler` equivalent; this is the
    // replacement.
    const onAppKey = (e: KeyboardEvent) => {
      if (isAppShortcut(e)) {
        e.stopImmediatePropagation()
      }
    }
    outer.addEventListener('keydown', onAppKey, true)

    // Light-mode class — wterm built-in. Dark mode uses wterm's default
    // (VS Code Dark+) palette, so no class is needed. Class goes on inner
    // because that's the `.wterm` element wterm reads CSS variables from.
    const darkMq = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = (isDark: boolean) => {
      inner.classList.toggle('theme-light', !isDark)
    }
    applyTheme(darkMq.matches)
    const onColorSchemeChange = (e: MediaQueryListEvent) =>
      applyTheme(e.matches)
    darkMq.addEventListener('change', onColorSchemeChange)
    ;(async () => {
      // Wait for custom fonts (Geist Mono, loaded async via
      // @fontsource-variable/geist) to be ready before constructing WTerm.
      // wterm measures char width once during init() to compute cols/rows; if
      // it measures with the fallback monospace font and Geist Mono lands
      // afterwards, the cell metrics are wrong and ResizeObserver does NOT
      // re-fire on font swaps (it only observes element size changes). The
      // user-visible symptom: the terminal doesn't fill the pane width until
      // the window is manually resized.
      //
      // document.fonts.ready resolves once all currently-pending fonts have
      // either loaded or failed — never hangs indefinitely.
      try {
        await document.fonts.ready
      } catch {
        // Some browsers may reject; proceed with whatever font is current.
      }

      if (cancelled) return

      term = new WTerm(inner, {
        cursorBlink: true,
        autoResize: true, // built-in ResizeObserver — replaces FitAddon
        onData: (data) => onDataRef.current(data),
        onResize: (cols, rows) => onResizeRef.current(cols, rows),
      })

      // init() loads the WASM core. Writes/resize calls before init resolves
      // are silently dropped — must await before exposing the handle.
      await term.init()

      if (cancelled) {
        term.destroy()
        term = null
        return
      }

      termRef.current = term

      // Force wterm's autoResize ResizeObserver to fire a fresh observation
      // with current dimensions. Without this, the terminal stays stuck at the
      // default 80x24 on first launch — the user's symptom is "the terminal
      // doesn't fill the pane width until I resize the window".
      //
      // Two reasons the initial observer firing can fail to size correctly:
      //   1. The first firing lands before flex layout has fully settled, so
      //      contentRect is smaller than the eventual settled size.
      //   2. wterm's observer callback does
      //         `if (newCols !== this.cols || newRows !== this.rows) resize(...)`
      //      so if the initial firing happens to compute the default 80x24
      //      (e.g. when char metrics are slightly off), no resize() call fires.
      //
      // Briefly perturbing inner's max-width by a sub-pixel amount triggers a
      // fresh ResizeObserver callback. wterm then re-measures char metrics and
      // calls resize() with the correct dimensions. The visual delta is
      // imperceptible (sub-pixel) and reverts on the next animation frame.
      requestAnimationFrame(() => {
        if (cancelled) return
        const orig = inner.style.maxWidth
        inner.style.maxWidth = 'calc(100% - 0.01px)'
        requestAnimationFrame(() => {
          if (cancelled) return
          inner.style.maxWidth = orig
        })
      })

      onReadyRef.current({
        write: (data) => termRef.current?.write(data),
        focus: () => termRef.current?.focus(),
      })
    })()

    return () => {
      cancelled = true
      outer.removeEventListener('keydown', onAppKey, true)
      darkMq.removeEventListener('change', onColorSchemeChange)
      if (term) term.destroy()
      // Remove our inner host. Idempotent if the node is already detached.
      inner.remove()
      termRef.current = null
    }
  }, []) // mount once — callbacks accessed via stable refs

  return (
    <div
      ref={containerRef}
      className={className ?? 'h-full min-h-0 w-full'}
      // Font / size — set via CSS custom props because wterm has no JS
      // options for these.
      style={
        {
          '--term-font-family':
            '"Geist Mono", "Cascadia Code", "Fira Code", monospace',
          '--term-font-size': '13px',
          '--term-line-height': '1.2',
        } as React.CSSProperties
      }
    />
  )
})
