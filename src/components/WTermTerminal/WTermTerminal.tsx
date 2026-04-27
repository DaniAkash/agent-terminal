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
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let term: WTerm | null = null

    // App-level shortcut interceptor — capture phase so it runs before
    // wterm's textarea keydown handler. stopImmediatePropagation prevents
    // wterm from converting the keystroke into PTY input. Intentionally NOT
    // preventDefault — react-hotkeys-hook still needs the event at the
    // document level.
    const onAppKey = (e: KeyboardEvent) => {
      if (isAppShortcut(e)) {
        e.stopImmediatePropagation()
      }
    }
    container.addEventListener('keydown', onAppKey, true)

    // Light-mode class — wterm built-in. Dark mode uses wterm's default
    // (VS Code Dark+) palette, so no class is needed.
    const darkMq = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = (isDark: boolean) => {
      container.classList.toggle('theme-light', !isDark)
    }
    applyTheme(darkMq.matches)
    const onColorSchemeChange = (e: MediaQueryListEvent) =>
      applyTheme(e.matches)
    darkMq.addEventListener('change', onColorSchemeChange)
    ;(async () => {
      // wterm appends children to `container` immediately; do not pass a
      // container holding other DOM you intend to keep.
      term = new WTerm(container, {
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

      onReadyRef.current({
        write: (data) => termRef.current?.write(data),
        focus: () => termRef.current?.focus(),
      })
    })()

    return () => {
      cancelled = true
      container.removeEventListener('keydown', onAppKey, true)
      darkMq.removeEventListener('change', onColorSchemeChange)
      term?.destroy()
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
