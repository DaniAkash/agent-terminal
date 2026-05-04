import { useStore } from '@nanostores/react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import React, { useEffect, useRef } from 'react'
import { $activeSearch } from '@/modules/stores/$activeSearch'
import { $fontSize } from '@/modules/stores/$fontSize'

export type XTermHandle = {
  write: (data: string) => void
  focus: () => void
  /** Clears the visible buffer + scrollback (xterm `term.clear()`). */
  clear: () => void
  /** Selects all text in the buffer. */
  selectAll: () => void
  /**
   * Jumps to the next match for the current `$activeSearch` query.
   * Pass `incremental: true` from typing-driven calls so the highlight
   * stays on the current match while it still matches the growing query
   * (xterm's addon-search expands the existing selection rather than
   * advancing past it). Default `false` matches the explicit Cmd+G
   * "next match" semantic.
   */
  searchNext: (opts?: { incremental?: boolean }) => void
  /** Jumps to the previous match for the current `$activeSearch` query. */
  searchPrevious: () => void
  /**
   * Writes data into the PTY as if the user typed it. Goes through the
   * same `onData` channel xterm uses for keypresses, so it ends up at
   * `IPC.writePty(tabKey, data)` via TerminalPane's `handleData`. Raw
   * — no transformation. Use for flows that genuinely simulate typing
   * (snippet expand, character-by-character autocomplete).
   */
  sendToPty: (data: string) => void
  /**
   * Writes data as a paste. If the running app has enabled bracketed
   * paste mode (DECSET 2004 — Claude Code, Codex, modern shells all
   * do), wraps the payload with `\x1b[200~` ... `\x1b[201~` so the
   * app can distinguish paste from typed input. Without that, agents
   * like Claude Code render dropped file paths as plain text instead
   * of attaching them as `[image]`.
   *
   * If bracketed paste is off (e.g., raw `cat` waiting for input),
   * sends unwrapped — otherwise the markers would appear as visible
   * escape garbage.
   */
  pasteToPty: (data: string) => void
}

type Props = {
  onReady: (handle: XTermHandle) => void
  onData: (data: string) => void
  onResize: (cols: number, rows: number) => void
  /**
   * True when the pane's tab is currently running an AI agent
   * (`$tabMeta[tabKey].type === 'agent'`). Drives the Shift+Enter /
   * Option+Enter newline translation in the key handler — outside agent
   * tabs those chords pass through unchanged.
   */
  isAgent: boolean
  className?: string
}

import { handleKeyEvent } from '@/components/XTermTerminal/xterm-terminal.keys'
import {
  DARK_THEME,
  LIGHT_THEME,
} from '@/components/XTermTerminal/xterm-terminal.themes'

export const XTermTerminal = React.memo(function XTermTerminal({
  onReady,
  onData,
  onResize,
  isAgent,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const fontSize = useStore($fontSize)

  // Keep callbacks (and the agent flag) in refs so the mount-once effect
  // always sees the latest versions without needing to re-run when they
  // change reference. The custom key handler reads `isAgentRef.current`
  // so toggling agent state mid-session reflects on the next keypress.
  const onReadyRef = useRef(onReady)
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const isAgentRef = useRef(isAgent)
  useEffect(() => {
    onReadyRef.current = onReady
    onDataRef.current = onData
    onResizeRef.current = onResize
    isAgentRef.current = isAgent
  }, [onReady, onData, onResize, isAgent])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let resizeObserver: ResizeObserver | null = null
    let fitTimer: ReturnType<typeof setTimeout> | null = null
    let webglAddon: WebglAddon | null = null

    const darkMq = window.matchMedia('(prefers-color-scheme: dark)')

    // xterm is fully synchronous — no WASM init required.
    // Read $fontSize.get() (not the closure-captured `fontSize`) so the
    // mount-once effect picks up any persisted value at construction time.
    const term = new Terminal({
      allowProposedApi: true, // required by @xterm/addon-webgl
      theme: darkMq.matches ? DARK_THEME : LIGHT_THEME,
      fontFamily: '"Geist Mono", "Cascadia Code", "Fira Code", monospace',
      fontSize: $fontSize.get(),
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowTransparency: false,
    })

    const fitAddon = new FitAddon()
    const unicode11Addon = new Unicode11Addon()
    const searchAddon = new SearchAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(unicode11Addon)
    term.loadAddon(searchAddon)
    term.open(container)

    // Activate Unicode 11 after open() per addon docs.
    term.unicode.activeVersion = '11'

    termRef.current = term
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    // Pass app-level shortcuts through to document-level hotkey handlers.
    // xterm calls preventDefault on keys it processes; returning false here
    // short-circuits that so the events bubble up to react-hotkeys-hook.
    // Single dispatch — see `xterm-terminal.keys.ts` for the precedence
    // rules between agent-newline / line-edit translation / app shortcut
    // bubbling / xterm default.
    term.attachCustomKeyEventHandler((e) =>
      handleKeyEvent(e, {
        isAgent: isAgentRef.current,
        onData: onDataRef.current,
      }),
    )

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
      clear: () => termRef.current?.clear(),
      selectAll: () => termRef.current?.selectAll(),
      searchNext: (opts) => {
        const s = $activeSearch.get()
        if (!s?.query) return
        searchAddonRef.current?.findNext(s.query, {
          caseSensitive: s.matchCase,
          wholeWord: s.wholeWord,
          regex: s.regex,
          incremental: opts?.incremental ?? false,
        })
      },
      searchPrevious: () => {
        const s = $activeSearch.get()
        if (!s?.query) return
        searchAddonRef.current?.findPrevious(s.query, {
          caseSensitive: s.matchCase,
          wholeWord: s.wholeWord,
          regex: s.regex,
        })
      },
      sendToPty: (data) => onDataRef.current(data),
      pasteToPty: (data) => {
        const term = termRef.current
        if (!term) return
        const wrap = term.modes.bracketedPasteMode
        const payload = wrap ? `\x1b[200~${data}\x1b[201~` : data
        onDataRef.current(payload)
      },
    })

    return () => {
      disposed = true
      darkMq.removeEventListener('change', onColorSchemeChange)
      if (fitTimer !== null) clearTimeout(fitTimer)
      resizeObserver?.disconnect()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      webglAddon?.dispose()
      searchAddon.dispose()
      fitAddon.dispose()
      unicode11Addon.dispose()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
    }
  }, []) // mount once — callbacks are accessed via stable refs

  // React to font-size changes globally. Defer fit() so the canvas
  // re-rasterizes glyphs at the new size before recomputing cols/rows.
  useEffect(() => {
    const term = termRef.current
    const fit = fitAddonRef.current
    if (!term || !fit) return
    term.options.fontSize = fontSize
    requestAnimationFrame(() => fit.fit())
  }, [fontSize])

  return (
    <div ref={containerRef} className={className ?? 'h-full min-h-0 w-full'} />
  )
})
