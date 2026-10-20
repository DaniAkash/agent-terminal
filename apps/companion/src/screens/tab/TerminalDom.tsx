'use dom'

import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { DOMImperativeFactory, DOMProps } from 'expo/dom'
import { useDOMImperativeHandle } from 'expo/dom'
import { type Ref, useEffect, useRef } from 'react'
import { attachTouchScroll } from './terminal-touch-scroll.helpers'

type Args = Parameters<DOMImperativeFactory[string]>

export interface TerminalHandle extends DOMImperativeFactory {
  write: (...args: Args) => void
  clear: (...args: Args) => void
  fit: (...args: Args) => void
}

interface TerminalDomProps {
  onData: (data: string) => Promise<void>
  onResize: (cols: number, rows: number) => Promise<void>
  onReady: () => Promise<void>
  ref: Ref<TerminalHandle>
  dom?: DOMProps
}

// xterm scrolls its viewport on wheel events and scrollbar drags, neither
// of which a finger produces. It ships a Gesture module that would cover
// this, but nothing in the library ever registers a target for it, so no
// gesture events are emitted and the scrollback is unreachable by touch.
// `touch-action: none` keeps the browser from claiming the drag so the
// listener below is the only thing acting on it.
const VIEWPORT_TOUCH_CSS = `
  .xterm-viewport,
  .xterm-screen {
    touch-action: none;
  }
`

export default function TerminalDom({
  onData,
  onResize,
  onReady,
  ref,
}: TerminalDomProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // Live refs to the latest callbacks. The setup useEffect below reads
  // these during xterm.js events without needing the props themselves in
  // its deps array. Keeps the effect (and the WebView-backed Terminal)
  // mounted across parent state changes, e.g. modifier arm/disarm in
  // TabScreen.
  //
  // Sync happens inside an effect (no deps → runs after every commit)
  // rather than direct render-time mutation so we stay safe against
  // React's concurrent-render replay semantics. Latency between prop
  // change and ref update is one render cycle, invisible here because
  // the refs are only read from later-fired xterm events + ResizeObserver
  // callbacks, both of which happen after commit anyway.
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onDataRef.current = onData
    onResizeRef.current = onResize
    onReadyRef.current = onReady
  })

  useDOMImperativeHandle(ref, () => ({
    write: (...args: Args) => {
      const data = args[0]
      if (typeof data === 'string') termRef.current?.write(data)
    },
    clear: () => {
      termRef.current?.clear()
    },
    fit: () => {
      fitRef.current?.fit()
    },
  }))

  useEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      cols: 80,
      rows: 24,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 2000,
      theme: {
        background: '#0e0f10',
        foreground: '#e6e8eb',
        cursor: '#e6e8eb',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    termRef.current = term
    fitRef.current = fit

    // Register listeners BEFORE the initial fit() so the resize event
    // it triggers (from the constructed 80x24 default to the container's
    // actual cols/rows) reaches the native side. Otherwise the desktop's
    // sidecar renders the snapshot at whatever dimensions the tab was
    // created with, and the initial hydration looks wrong on mobile.
    const dataDisposable = term.onData((data) => {
      void onDataRef.current(data)
    })
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      void onResizeRef.current(cols, rows)
    })

    const detachTouchScroll = attachTouchScroll(term)

    fit.fit()

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(containerRef.current)

    void onReadyRef.current()

    return () => {
      detachTouchScroll()
      observer.disconnect()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  return (
    <>
      {/* Mirrors the Android HTML's rule. touch-action is the part that
          matters: without it a vertical drag is claimed by xterm's pointer
          handlers and becomes a text selection, so the scrollback stays out
          of reach no matter how the host WebView is configured. */}
      <style>{VIEWPORT_TOUCH_CSS}</style>
      <div
        ref={containerRef}
        style={{
          width: '100vw',
          height: '100vh',
          background: '#0e0f10',
        }}
      />
    </>
  )
}
