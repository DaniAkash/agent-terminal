import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import type { ITheme } from '@xterm/xterm'
import { Terminal } from '@xterm/xterm'
import React, { useEffect, useRef } from 'react'

export type XTermHandle = {
  write: (data: string) => void
  focus: () => void
}

type Props = {
  onReady: (handle: XTermHandle) => void
  onData: (data: string) => void
  onResize: (cols: number, rows: number) => void
  className?: string
}

// VS Code Dark+ palette, sourced from VS Code's terminal defaults
// (src/vs/workbench/contrib/terminal/browser/terminalConfiguration.ts, MIT).
//
// Deviations from upstream:
//   - `background` is set to `#0e0f10` (upstream `#1e1e1e`) so the terminal
//     pane matches the app's --terminal-background CSS variable and blends
//     with the surrounding chrome.
//   - `cursorAccent` follows the overridden background. cursorAccent is
//     drawn behind a block-style cursor and must equal the terminal bg for
//     the cursor character to invert cleanly; it's a derived value, not an
//     independent palette choice.
//
// Every other slot (foreground, cursor, ANSI 16, selection) is upstream-faithful.
//
// `selectionForeground` is the load-bearing addition vs. the previous
// hand-rolled palette: without it, xterm.js leaves the glyph colour
// unchanged when a cell is selected, causing the WebGL renderer to
// re-rasterise glyphs with shifted contrast and producing a visible
// "font wobble" during selection.
const DARK_THEME: ITheme = {
  background: '#0e0f10', // matches --terminal-background (dark)
  foreground: '#cccccc',
  cursor: '#aeafad',
  cursorAccent: '#0e0f10',
  selectionBackground: '#264f78',
  selectionForeground: '#ffffff',
  selectionInactiveBackground: '#3a3d41',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
}

// VS Code Light+ palette, same source as Dark+ above.
const LIGHT_THEME: ITheme = {
  background: '#ffffff', // matches --terminal-background (light)
  foreground: '#333333',
  cursor: '#333333',
  cursorAccent: '#ffffff',
  selectionBackground: '#add6ff',
  selectionForeground: '#000000',
  selectionInactiveBackground: '#e5ebf1',
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
}

// Returns true when the key combo is claimed by the app's hotkey layer
// (react-hotkeys-hook at document level). Returning false from xterm's
// attachCustomKeyEventHandler skips xterm's own handler so the event bubbles.
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

export const XTermTerminal = React.memo(function XTermTerminal({
  onReady,
  onData,
  onResize,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // Keep callbacks in refs so the mount-once effect always calls the latest
  // versions without needing to re-run when they change reference.
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
    let disposed = false
    let resizeObserver: ResizeObserver | null = null
    let fitTimer: ReturnType<typeof setTimeout> | null = null
    let webglAddon: WebglAddon | null = null

    const darkMq = window.matchMedia('(prefers-color-scheme: dark)')

    // xterm is fully synchronous — no WASM init required.
    const term = new Terminal({
      allowProposedApi: true, // required by @xterm/addon-webgl
      theme: darkMq.matches ? DARK_THEME : LIGHT_THEME,
      fontFamily: '"Geist Mono", "Cascadia Code", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowTransparency: false,
    })

    const fitAddon = new FitAddon()
    const unicode11Addon = new Unicode11Addon()

    term.loadAddon(fitAddon)
    term.loadAddon(unicode11Addon)
    term.open(container)

    // Activate Unicode 11 after open() per addon docs.
    term.unicode.activeVersion = '11'

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Pass app-level shortcuts through to document-level hotkey handlers.
    // xterm calls preventDefault on keys it processes; returning false here
    // short-circuits that so the events bubble up to react-hotkeys-hook.
    term.attachCustomKeyEventHandler((e) => !isAppShortcut(e))

    // WebGL renderer — falls back to xterm's built-in DOM renderer on context
    // loss. The canvas addon is not used: it is v5-only and was removed in v6.
    try {
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose()
        webglAddon = null
        // xterm DOM renderer takes over automatically after WebGL is disposed.
      })
      term.loadAddon(webglAddon)
    } catch {
      // WebGL2 not available — xterm DOM renderer takes over automatically.
      webglAddon = null
    }

    // Swap theme instantly when the OS colour scheme changes.
    const onColorSchemeChange = (e: MediaQueryListEvent) => {
      if (!disposed) term.options.theme = e.matches ? DARK_THEME : LIGHT_THEME
    }
    darkMq.addEventListener('change', onColorSchemeChange)

    // Drive fit() via ResizeObserver — fires after layout, no debounce needed.
    // term.onResize notifies the PTY of the new cols/rows via the onResize prop.
    resizeObserver = new ResizeObserver((entries) => {
      if (disposed) return
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          fitAddon.fit()
          break
        }
      }
    })
    resizeObserver.observe(container)

    // Belt-and-suspenders: fit() again after 50ms for font metric edge cases.
    fitTimer = setTimeout(() => {
      if (!disposed) fitAddon.fit()
    }, 50)

    const dataDisposable = term.onData((data) => onDataRef.current(data))
    const resizeDisposable = term.onResize(({ cols, rows }) =>
      onResizeRef.current(cols, rows),
    )

    onReadyRef.current({
      write: (data) => termRef.current?.write(data),
      focus: () => termRef.current?.focus(),
    })

    return () => {
      disposed = true
      darkMq.removeEventListener('change', onColorSchemeChange)
      if (fitTimer !== null) clearTimeout(fitTimer)
      resizeObserver?.disconnect()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      webglAddon?.dispose()
      fitAddon.dispose()
      unicode11Addon.dispose()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, []) // mount once — callbacks are accessed via stable refs

  return (
    <div ref={containerRef} className={className ?? 'h-full min-h-0 w-full'} />
  )
})
