import { linkifyRows, openableHref } from '@agent-terminal/core-ui'
import { useStore } from '@nanostores/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { WTerm } from '@wterm/dom'
import { GhosttyCore } from '@wterm/ghostty'
import React, { useEffect, useRef } from 'react'
import {
  createWTermHandle,
  type WTermHandle,
} from '@/components/WTermTerminal/wterm-terminal.handle'
import { classifyKeyEvent } from '@/components/WTermTerminal/wterm-terminal.keys'
import {
  coreThemeHex,
  terminalTheme,
} from '@/components/WTermTerminal/wterm-terminal.themes'
import { $activeSearch } from '@/modules/stores/$activeSearch'
import { $fontSize } from '@/modules/stores/$fontSize'

type Props = {
  onReady: (handle: WTermHandle) => void
  onData: (data: string) => void
  onResize: (cols: number, rows: number) => void
  /**
   * True when the pane's tab is running an AI agent. Drives the
   * Shift+Enter and Option+Enter newline translation; outside agent tabs
   * those chords pass through unchanged.
   */
  isAgent: boolean
  /**
   * True when the pane is the visible one. Hidden panes stop painting,
   * so a workspace with many tabs does no render work for the ones
   * nobody is looking at. The core keeps parsing, so scrollback and
   * state stay correct while paused.
   */
  isActive: boolean
  className?: string
}

/** Marks the copy of an app shortcut this component re-emits on document. */
// ghostty budgets scrollback in bytes, not lines, and allocates it in
// pages, so the retained row count falls as the terminal gets wider.
// Measured against this core: 8 MB holds about 4,900 rows at 120
// columns and about 7,200 at 80, covering the 5,000 lines xterm was
// configured for here. The default is 10,000 bytes, about 535 rows.
const SCROLLBACK_BYTES = 8_000_000

const FORWARDED = '__wtermForwarded'

export const WTermTerminal = React.memo(function WTermTerminal({
  onReady,
  onData,
  onResize,
  isAgent,
  isActive,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<WTerm | null>(null)
  const fontSize = useStore($fontSize)

  const onReadyRef = useRef(onReady)
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const isAgentRef = useRef(isAgent)
  const isActiveRef = useRef(isActive)
  useEffect(() => {
    onReadyRef.current = onReady
    onDataRef.current = onData
    onResizeRef.current = onResize
    isAgentRef.current = isAgent
    isActiveRef.current = isActive
  }, [onReady, onData, onResize, isAgent, isActive])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let term: WTerm | null = null
    let core: GhosttyCore | null = null

    // wterm's destroy() empties the element it was given. Under
    // StrictMode the first mount's destroy resolves after the second
    // mount has already built its grid, so a shared host would be wiped
    // out from under the live terminal. Giving each mount its own inner
    // host keeps a late destroy confined to the subtree that owns it.
    const host = document.createElement('div')
    host.style.width = '100%'
    host.style.height = '100%'
    // wterm styles its root as a standalone card: 12px padding, an 8px
    // radius and a large drop shadow. Inside a pane that reads as a
    // floating panel, and on the light theme the shadow draws a grey
    // halo along the edges.
    host.style.padding = '2px'
    host.style.borderRadius = '0'
    host.style.boxShadow = 'none'
    container.appendChild(host)

    const darkMq = window.matchMedia('(prefers-color-scheme: dark)')

    function onKeyDownCapture(e: KeyboardEvent) {
      if (FORWARDED in e) return
      const verdict = classifyKeyEvent(e, {
        isAgent: isAgentRef.current,
        onData: onDataRef.current,
      })
      if (verdict === 'terminal') return

      // wterm's own listener sits on the textarea, below this one, and
      // has no defaultPrevented check, so the only way to keep a key
      // away from it is to stop the event here.
      e.stopImmediatePropagation()

      // Stopping it also keeps it from reaching react-hotkeys-hook,
      // which binds on the document in the bubble phase, so an app
      // shortcut is re-emitted there as a fresh event. The marker stops
      // that copy from re-entering this handler.
      if (verdict === 'app-shortcut') {
        const forwarded = new KeyboardEvent(e.type, {
          key: e.key,
          code: e.code,
          location: e.location,
          repeat: e.repeat,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          bubbles: true,
          cancelable: true,
        })
        Object.defineProperty(forwarded, FORWARDED, { value: true })
        document.dispatchEvent(forwarded)
      }
    }

    // Links are rendered as real anchors, and the webview would either
    // no-op on them or navigate the app window away. Route them to the
    // OS browser instead, the same thing the xterm web-links addon did.
    function onClickCapture(e: MouseEvent) {
      const anchor = (e.target as Element | null)?.closest('a[href]')
      if (!anchor) return
      // Always swallow the navigation: letting the webview follow a
      // terminal-authored href would take the app window off its own
      // page. An OSC 8 href is written by whatever produced the output,
      // so it reaches the OS opener only once its scheme checks out.
      e.preventDefault()
      const href = openableHref(anchor.getAttribute('href'))
      if (href) openUrl(href).catch(() => {})
    }

    host.addEventListener('keydown', onKeyDownCapture, { capture: true })
    host.addEventListener('keyup', onKeyDownCapture, { capture: true })
    host.addEventListener('click', onClickCapture, { capture: true })

    // wterm rebuilds a row's markup whenever it repaints, which discards
    // the anchors from the previous pass, so they are reapplied per frame
    // rather than once. Coalescing into an animation frame keeps a burst
    // of output to one sweep.
    let linkFrame = 0
    const linkObserver = new MutationObserver(() => {
      if (disposed || linkFrame !== 0) return
      linkFrame = requestAnimationFrame(() => {
        linkFrame = 0
        if (!disposed) linkifyRows(host)
      })
    })
    linkObserver.observe(host, { childList: true, subtree: true })

    const mo = new MutationObserver(() => {
      if (disposed || !term) return
      term.setThemeColors(
        terminalTheme(
          document.documentElement.getAttribute('data-theme'),
          darkMq.matches,
        ),
      )
    })
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    async function boot() {
      const theme = terminalTheme(
        document.documentElement.getAttribute('data-theme'),
        darkMq.matches,
      )

      // The cell grid is measured from the font, so a terminal built
      // before Geist Mono has loaded sizes itself against the fallback
      // and lands on the wrong cols and rows.
      await document.fonts.ready

      // Each terminal owns its own core: the core holds that session's
      // grid and scrollback. The WASM module itself is compiled once per
      // URL and shared, so the later ones are cheap.
      core = await GhosttyCore.load({
        scrollbackLimit: SCROLLBACK_BYTES,
        ...coreThemeHex(theme),
      })
      if (disposed) {
        core.dispose()
        return
      }

      term = new WTerm(host, {
        core,
        autoResize: true,
        cursorBlink: true,
        renderingPaused: !isActiveRef.current,
        onData: (data) => onDataRef.current(data),
        onResize: (cols, rows) => onResizeRef.current(cols, rows),
      })
      await term.init()
      if (disposed) {
        term.destroy()
        core.dispose()
        return
      }

      term.setThemeColors(theme)
      termRef.current = term

      onReadyRef.current(
        createWTermHandle({
          getTerm: () => termRef.current,
          sendData: (data) => onDataRef.current(data),
        }),
      )
    }

    boot().catch((err: unknown) => {
      // biome-ignore lint/suspicious/noConsole: a failed core load leaves an empty pane, which needs a breadcrumb in devtools
      console.error('[WTermTerminal] wterm boot failed:', err)
    })

    return () => {
      disposed = true
      mo.disconnect()
      linkObserver.disconnect()
      if (linkFrame !== 0) cancelAnimationFrame(linkFrame)
      host.removeEventListener('keydown', onKeyDownCapture, { capture: true })
      host.removeEventListener('keyup', onKeyDownCapture, { capture: true })
      host.removeEventListener('click', onClickCapture, { capture: true })
      term?.destroy()
      // destroy() deliberately leaves a host-supplied core alone, so the
      // WASM instance behind it is this component's to release.
      core?.dispose()
      termRef.current = null
      host.remove()
    }
  }, []) // mount once, callbacks reach the latest props through refs

  useEffect(() => {
    termRef.current?.setRenderingPaused(!isActive)
  }, [isActive])

  // Emptying the find field, and closing the bar, both leave the store
  // without a query but neither calls back into the terminal, so the
  // highlights from the last query stayed on screen until something else
  // searched. Watching the store covers both, and clearing a terminal
  // that is not searching costs nothing.
  useEffect(
    () =>
      $activeSearch.subscribe((search) => {
        if (!search?.query) termRef.current?.clearSearch()
      }),
    [],
  )

  // wterm reads the cell size from CSS and re-measures when the value
  // changes, so the font size is set as a custom property rather than
  // through an option.
  useEffect(() => {
    containerRef.current?.style.setProperty('--term-font-size', `${fontSize}px`)
  }, [fontSize])

  return (
    <div
      ref={containerRef}
      className={className ?? 'h-full min-h-0 w-full'}
      style={
        {
          '--term-font-family':
            '"Geist Mono", "Cascadia Code", "Fira Code", monospace',
          '--term-font-size': `${fontSize}px`,
          '--term-line-height': '1.2',
        } as React.CSSProperties
      }
    />
  )
})
