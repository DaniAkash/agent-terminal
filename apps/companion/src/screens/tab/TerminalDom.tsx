'use dom'

import { WTerm } from '@wterm/dom'
import '@wterm/dom/css'
import { GhosttyCore } from '@wterm/ghostty'
import type { DOMImperativeFactory, DOMProps } from 'expo/dom'
import { useDOMImperativeHandle } from 'expo/dom'
import { type Ref, useEffect, useRef } from 'react'
// @ts-expect-error Metro resolves this through `assetExts`, which has no types.
import wasmAsset from '@wterm/ghostty/wasm/ghostty-vt.wasm'
import { assetUrl } from './ghostty-wasm.helpers'
import { useTerminalCallbackRefs } from './terminal-callbacks.hooks'

type Args = Parameters<DOMImperativeFactory[string]>

export interface TerminalHandle extends DOMImperativeFactory {
  write: (...args: Args) => void
  clear: (...args: Args) => void
  fit: (...args: Args) => void
  /** Drop focus so the next tap on the terminal can take it again. */
  blurInput: (...args: Args) => void
}

interface TerminalDomProps {
  onData: (data: string) => Promise<void>
  onResize: (cols: number, rows: number) => Promise<void>
  onReady: () => Promise<void>
  ref: Ref<TerminalHandle>
  dom?: DOMProps
}

/** Erase the screen, erase the scrollback, home the cursor. */
const CLEAR_SEQUENCE = '\x1b[2J\x1b[3J\x1b[H'

const THEME = {
  background: 0x0e0f10,
  foreground: 0xe6e8eb,
  cursor: 0xe6e8eb,
  palette: [
    0x000000, 0xcd3131, 0x0dbc79, 0xe5e510, 0x2472c8, 0xbc3fbc, 0x11a8cd,
    0xe5e5e5, 0x666666, 0xf14c4c, 0x23d18b, 0xf5f543, 0x3b8eea, 0xd670d6,
    0x29b8db, 0xe5e5e5,
  ],
} as const

// wterm draws cells as DOM nodes and lets the scrollback be a real
// overflow container, so a finger scrolls it the way it scrolls any
// other page. The whole touch-scroll shim xterm needed is gone with it.
// `overscroll-behavior` keeps a flick at the top of the scrollback from
// becoming a pull-to-refresh on the WebView itself.
const HOST_CSS = `
  html, body { margin: 0; padding: 0; background: #0e0f10; }
  .wterm {
    width: 100vw;
    height: 100vh;
    padding: 0;
    border-radius: 0;
    box-shadow: none;
    overscroll-behavior: contain;
    -webkit-text-size-adjust: 100%;
    --term-font-family: ui-monospace, "SF Mono", Menlo, monospace;
    --term-font-size: 12px;
    --term-line-height: 1.2;
  }
`

export default function TerminalDom({
  onData,
  onResize,
  onReady,
  ref,
}: TerminalDomProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<WTerm | null>(null)

  const {
    onData: onDataRef,
    onResize: onResizeRef,
    onReady: onReadyRef,
  } = useTerminalCallbackRefs({ onData, onResize, onReady })

  useDOMImperativeHandle(ref, () => ({
    write: (...args: Args) => {
      const data = args[0]
      if (typeof data === 'string') termRef.current?.write(data)
    },
    clear: () => {
      termRef.current?.write(CLEAR_SEQUENCE)
    },
    fit: () => {
      termRef.current?.fit()
    },
    // The keyboard is raised by focus CHANGING, and the terminal keeps
    // its hidden textarea focused after the keyboard goes away, so a
    // later tap is not a change and the keyboard never returns. Giving
    // the focus up when the keyboard does leaves the next tap able to
    // take it, which is the path that raises the keyboard on a freshly
    // opened session.
    blurInput: () => {
      const textarea = termRef.current?.element.querySelector('textarea')
      textarea?.blur()
    },
  }))

  // The refs exist to keep this effect out of the dependency graph.
  // Listing their `.current` reads would remount the terminal on every
  // parent render, which is the remount the indirection exists to stop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let term: WTerm | null = null
    let core: GhosttyCore | null = null

    async function boot() {
      // Metro has no notion of the `new URL(..., import.meta.url)` asset
      // pattern the default loader uses, so the binary is located for it.
      core = await GhosttyCore.load({
        wasmPath: assetUrl(wasmAsset),
        foregroundColor: '#e6e8eb',
        backgroundColor: '#0e0f10',
      })
      if (disposed) {
        core.dispose()
        return
      }

      term = new WTerm(container as HTMLElement, {
        core,
        autoResize: true,
        cursorBlink: true,
        // Registered up front rather than after init, so the resize from
        // the default 80x24 to the container's real size reaches the
        // native side. Otherwise the desktop renders its snapshot at
        // whatever size the tab was created with and the first paint on
        // the phone is wrong.
        onData: (data) => {
          void onDataRef.current(data)
        },
        onResize: (cols, rows) => {
          void onResizeRef.current(cols, rows)
        },
      })
      await term.init()
      if (disposed) {
        term.destroy()
        core.dispose()
        return
      }

      term.setThemeColors({ ...THEME, palette: [...THEME.palette] })
      termRef.current = term
      void onReadyRef.current()
    }

    void boot()

    return () => {
      disposed = true
      term?.destroy()
      // destroy() leaves a host-supplied core alone by design, so the
      // WASM instance behind it is this component's to release.
      core?.dispose()
      termRef.current = null
    }
  }, [])

  return (
    <>
      <style>{HOST_CSS}</style>
      <div
        ref={containerRef}
        style={{ width: '100vw', height: '100vh', background: '#0e0f10' }}
      />
    </>
  )
}
