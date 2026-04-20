import type { Terminal as TerminalType } from 'ghostty-web'
import { FitAddon, init, Terminal } from 'ghostty-web'
import React, { useEffect, useRef } from 'react'

// WASM init is a one-time global operation. The promise is shared across all
// terminal instances so WASM is only loaded and compiled once per session.
let wasmReady = false
let initPromise: Promise<void> | null = null

function ensureWasmInit(): Promise<void> {
  if (wasmReady) return Promise.resolve()
  if (!initPromise) {
    initPromise = init().then(() => {
      wasmReady = true
    })
  }
  return initPromise
}

// Read current CSS variable value from the document root.
// Used to pass theme colors to ghostty-web at mount time.
function readCSSVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
}

export type GhosttyTerminalHandle = {
  write: (data: string) => void
  focus: () => void
}

type Props = {
  onReady: (handle: GhosttyTerminalHandle) => void
  onData: (data: string) => void
  className?: string
}

export const GhosttyTerminal = React.memo(function GhosttyTerminal({
  onReady,
  onData,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<TerminalType | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // Keep callbacks in refs so the mount-once effect always calls the latest
  // versions without needing to re-run when they change reference.
  const onReadyRef = useRef(onReady)
  const onDataRef = useRef(onData)
  useEffect(() => {
    onReadyRef.current = onReady
    onDataRef.current = onData
  }, [onReady, onData])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let dataDisposableCleanup: (() => void) | null = null

    ensureWasmInit().then(() => {
      if (disposed) return

      const term = new Terminal({
        // Font settings
        fontSize: 12.5,
        fontFamily:
          '"GeistMono Nerd Font", "GeistMono NF", "Geist Mono", monospace',
        cursorBlink: true,
        scrollback: 5000,
        // Theme colors read from CSS variables at mount time.
        // ghostty-web does not observe CSS variables — colors are set once at init.
        theme: {
          foreground: readCSSVar('--terminal-foreground'),
          background: readCSSVar('--terminal-background'),
          cursor: readCSSVar('--terminal-foreground'),
          black: readCSSVar('--term-color-0'),
          red: readCSSVar('--term-color-1'),
          green: readCSSVar('--term-color-2'),
          yellow: readCSSVar('--term-color-3'),
          blue: readCSSVar('--term-color-4'),
          magenta: readCSSVar('--term-color-5'),
          cyan: readCSSVar('--term-color-6'),
          white: readCSSVar('--term-color-7'),
          brightBlack: readCSSVar('--term-color-8'),
          brightRed: readCSSVar('--term-color-9'),
          brightGreen: readCSSVar('--term-color-10'),
          brightYellow: readCSSVar('--term-color-11'),
          brightBlue: readCSSVar('--term-color-12'),
          brightMagenta: readCSSVar('--term-color-13'),
          brightCyan: readCSSVar('--term-color-14'),
          brightWhite: readCSSVar('--term-color-15'),
        },
      })

      // FitAddon handles resize by measuring the container and calling term.resize().
      // observeResize() sets up a ResizeObserver for automatic fit on container changes.
      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)

      term.open(container)
      fitAddon.observeResize()

      // Defer the initial fit() to after the browser has completed layout.
      // fit() calls container.clientWidth/clientHeight — if called synchronously
      // inside a promise callback the browser may not have painted yet, so the
      // container reports 0×0 and the terminal stays at the default 80-column size.
      requestAnimationFrame(() => {
        if (!disposed) fitAddon.fit()
      })

      termRef.current = term
      fitAddonRef.current = fitAddon

      // onData is an IEvent<string>: call it with a listener to get an IDisposable.
      const dataDisposable = term.onData((data) => onDataRef.current(data))
      dataDisposableCleanup = () => dataDisposable.dispose()

      onReadyRef.current({
        write: (data) => termRef.current?.write(data),
        focus: () => termRef.current?.focus(),
      })
    })

    return () => {
      disposed = true
      dataDisposableCleanup?.()
      fitAddonRef.current?.dispose()
      termRef.current?.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, []) // mount once — callbacks are accessed via stable refs

  return (
    <div ref={containerRef} className={className ?? 'h-full min-h-0 w-full'} />
  )
})
