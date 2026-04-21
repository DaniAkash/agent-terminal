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

const DARK_THEME: ITheme = {
  background: '#0d0d0d',
  foreground: '#e8e8e8',
  cursor: '#e8e8e8',
  selectionBackground: '#3a3a3a',
  black: '#1a1a1a',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#4b5263',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
}

const LIGHT_THEME: ITheme = {
  background: '#fafafa',
  foreground: '#383a42',
  cursor: '#526fff',
  selectionBackground: '#d0d1d3',
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#a0a1a7',
  brightBlack: '#4f525e',
  brightRed: '#e45649',
  brightGreen: '#50a14f',
  brightYellow: '#c18401',
  brightBlue: '#4078f2',
  brightMagenta: '#a626a4',
  brightCyan: '#0184bc',
  brightWhite: '#383a42',
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
