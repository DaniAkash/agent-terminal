import { useStore } from '@nanostores/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { WTerm } from '@wterm/dom'
import { GhosttyCore } from '@wterm/ghostty'
import React, { useEffect, useRef } from 'react'
import { classifyKeyEvent } from '@/components/WTermTerminal/wterm-terminal.keys'
import {
  coreThemeHex,
  terminalTheme,
} from '@/components/WTermTerminal/wterm-terminal.themes'
import { $activeSearch } from '@/modules/stores/$activeSearch'
import { $fontSize } from '@/modules/stores/$fontSize'

export type WTermHandle = {
  write: (data: string) => void
  focus: () => void
  /** Clears the visible buffer and the scrollback. */
  clear: () => void
  /** Selects all text in the buffer. */
  selectAll: () => void
  /**
   * Jumps to the next match for the current `$activeSearch` query.
   *
   * `incremental` exists so a typing-driven call can leave the highlight
   * on the match it is already sitting on while that match still
   * satisfies the growing query, instead of advancing past it.
   */
  searchNext: (opts?: { incremental?: boolean }) => void
  /** Jumps to the previous match for the current `$activeSearch` query. */
  searchPrevious: () => void
  /**
   * Writes data into the PTY as if the user typed it. Goes through the
   * same `onData` channel wterm uses for keypresses, so it ends up at
   * `IPC.writePty(tabKey, data)` via TerminalPane's `handleData`. Raw,
   * no transformation. Use for flows that genuinely simulate typing.
   */
  sendToPty: (data: string) => void
  /**
   * Writes data as a paste. If the running app has enabled bracketed
   * paste mode (DECSET 2004, which Claude Code, Codex and modern shells
   * all do), wraps the payload so the app can tell paste from typing.
   * Without that, agents render a dropped file path as plain text
   * instead of attaching it.
   *
   * If bracketed paste is off, sends unwrapped, because the markers
   * would otherwise show up as visible escape garbage.
   */
  pasteToPty: (data: string) => void
}

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

/** Erase the screen, erase the scrollback, home the cursor. */
const CLEAR_SEQUENCE = '\x1b[2J\x1b[3J\x1b[H'

/** Marks the copy of an app shortcut this component re-emits on document. */
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
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return
      e.preventDefault()
      openUrl(href).catch(() => {})
    }

    host.addEventListener('keydown', onKeyDownCapture, { capture: true })
    host.addEventListener('keyup', onKeyDownCapture, { capture: true })
    host.addEventListener('click', onClickCapture, { capture: true })

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
      core = await GhosttyCore.load({ ...coreThemeHex(theme) })
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

      onReadyRef.current({
        write: (data) => termRef.current?.write(data),
        focus: () => termRef.current?.focus(),
        clear: () => termRef.current?.write(CLEAR_SEQUENCE),
        selectAll: () => {
          void termRef.current?.selectAll()
        },
        searchNext: (opts) => {
          const active = termRef.current
          const s = $activeSearch.get()
          if (!active || !s?.query) return
          // search() restarts from the top, so re-running it for an
          // incremental keystroke would drop the caller back to the
          // first match. Only re-run when the query itself changed.
          if (active.getSearchState().query !== s.query) {
            active.search(s.query, { caseSensitive: s.matchCase })
            if (opts?.incremental) return
          }
          active.findNext()
        },
        searchPrevious: () => {
          const active = termRef.current
          const s = $activeSearch.get()
          if (!active || !s?.query) return
          if (active.getSearchState().query !== s.query) {
            active.search(s.query, { caseSensitive: s.matchCase })
          }
          active.findPrevious()
        },
        sendToPty: (data) => onDataRef.current(data),
        pasteToPty: (data) => {
          const bracketed = termRef.current?.bridge?.bracketedPaste() ?? false
          onDataRef.current(bracketed ? `\x1b[200~${data}\x1b[201~` : data)
        },
      })
    }

    boot().catch((err: unknown) => {
      // biome-ignore lint/suspicious/noConsole: a failed core load leaves an empty pane, which needs a breadcrumb in devtools
      console.error('[WTermTerminal] wterm boot failed:', err)
    })

    return () => {
      disposed = true
      mo.disconnect()
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
