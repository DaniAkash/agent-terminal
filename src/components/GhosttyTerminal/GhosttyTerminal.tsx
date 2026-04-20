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

export type GhosttyTerminalHandle = {
  write: (data: string) => void
  focus: () => void
}

type Props = {
  onReady: (handle: GhosttyTerminalHandle) => void
  onData: (data: string) => void
  onResize: (cols: number, rows: number) => void
  className?: string
}

export const GhosttyTerminal = React.memo(function GhosttyTerminal({
  onReady,
  onData,
  onResize,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<TerminalType | null>(null)
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
    let disposablesCleanup: (() => void) | null = null
    let resizeObserver: ResizeObserver | null = null
    let fitTimer: ReturnType<typeof setTimeout> | null = null

    ensureWasmInit().then(() => {
      if (disposed) return

      const term = new Terminal()

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(container)

      termRef.current = term
      fitAddonRef.current = fitAddon

      // Drive fit() via our own ResizeObserver — no debounce, fires after layout.
      // term.onResize notifies the PTY of the new cols/rows via onResize prop.
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

      // Belt-and-suspenders: fit() again after 50ms in case the ResizeObserver
      // fires before WASM font metrics are fully initialized.
      fitTimer = setTimeout(() => {
        if (!disposed) fitAddon.fit()
      }, 50)

      // onData / onResize are IEvent<T>: call with a listener to get an IDisposable.
      const dataDisposable = term.onData((data) => onDataRef.current(data))
      // onResize fires whenever fit() calls term.resize() — notify the PTY so the
      // shell reformats its output to match the new cols/rows.
      const resizeDisposable = term.onResize(({ cols, rows }) =>
        onResizeRef.current(cols, rows),
      )
      disposablesCleanup = () => {
        dataDisposable.dispose()
        resizeDisposable.dispose()
      }

      onReadyRef.current({
        write: (data) => termRef.current?.write(data),
        focus: () => termRef.current?.focus(),
      })
    })

    return () => {
      disposed = true
      if (fitTimer !== null) clearTimeout(fitTimer)
      resizeObserver?.disconnect()
      disposablesCleanup?.()
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
