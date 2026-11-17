import { openableHref } from '@agent-terminal/core-ui'
import { useStore } from '@nanostores/react'
import { decode } from 'js-base64'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking } from 'react-native'
import { $session } from '@/modules/stores/$session'
import {
  resizeTab as resizeTabWss,
  subscribeToTab,
  unsubscribeFromTab,
  writeToTab,
} from '@/modules/wss/client'
import { applyAlt, applyCtrl } from './extra-keys.helpers'
import type { TerminalHandle } from './TerminalDom'
import {
  useActiveTabInfo,
  useClosedTab,
  useConnectionNotices,
  useNoteRecency,
} from './tab.hooks'

const SCROLLBACK = 2000

// Long enough that raising the soft keyboard, which resizes the WebView
// through an animation, settles into one declaration instead of a burst
// of them.
const VIEWPORT_DECLARATION_DEBOUNCE_MS = 150

/**
 * Everything the terminal screen needs, composed from the smaller hooks.
 *
 * `tabId` changing is a session switch, not a remount: the stream effect
 * below resubscribes and the webview keeps running, which is the whole
 * reason swiping between sessions costs a frame rather than a reload.
 */
// fallow-ignore-next-line complexity
export function useTabData(projectId: string, tabId: string) {
  const terminalRef = useRef<TerminalHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [ctrlArmed, setCtrlArmed] = useState(false)
  const [altArmed, setAltArmed] = useState(false)

  // Single funnel for input coming from either the terminal's onData path
  // (soft keyboard capture) or the ExtraKeysBar. Applies any armed
  // modifier, sends the byte sequence over the WSS, then disarms.
  // Rewritten on every commit to close over the latest state; consumers
  // reach it through the ref so their callback identity stays stable.
  //
  // Sync inside an effect (no deps → runs after every commit) instead of
  // direct render-time mutation. Refs are only read from onData /
  // onKey which fire from user events after commit, so the one-render-
  // cycle latency between a state change (arm/disarm) and the next
  // input read is invisible.
  const sendInputRef = useRef<(seq: string) => void>(() => {})
  useEffect(() => {
    // fallow-ignore-next-line complexity
    sendInputRef.current = (seq: string) => {
      let out = seq
      if (ctrlArmed) out = applyCtrl(out)
      if (altArmed) out = applyAlt(out)
      writeToTab(tabId, out)
      if (ctrlArmed) setCtrlArmed(false)
      if (altArmed) setAltArmed(false)
    }
  })

  useEffect(() => {
    if (!ready) return
    subscribeToTab(tabId, SCROLLBACK, {
      onSnapshot: (payload) => {
        const handle = terminalRef.current
        if (typeof handle?.clear !== 'function') return
        handle.clear()
        handle.write(payload)
      },
      onBytes: (b64) => {
        const handle = terminalRef.current
        if (typeof handle?.write !== 'function') return
        handle.write(decode(b64))
      },
      // The grid is the desktop's to decide. History is serialized against
      // the width that produced it, so rendering it at any other width
      // turns cursor moves into junk; the phone adopts the size it is told
      // and pans over the result.
      onResized: (cols, rows) => {
        const handle = terminalRef.current
        if (typeof handle?.resize !== 'function') return
        handle.resize(cols, rows)
      },
    })
    return () => {
      unsubscribeFromTab(tabId)
    }
  }, [tabId, ready])

  const onReady = useCallback(async () => {
    // Fires once per webview mount. Switching sessions must NOT produce a
    // second one: that would mean the terminal was torn down and rebuilt
    // rather than just re-pointed at another stream.
    console.log('[terminal] webview ready')
    setReady(true)
  }, [])

  // The href arrives from a WebView, so the scheme is checked again on
  // this side rather than trusted from the page that sent it.
  const onOpenUrl = useCallback(async (url: string) => {
    const href = openableHref(url)
    if (!href) return
    await Linking.openURL(href).catch(() => {})
  }, [])

  const onData = useCallback(async (data: string) => {
    sendInputRef.current(data)
  }, [])

  // A declaration, not a command: the hub decides the grid and answers
  // with `onResized`, which may well be a different size. It settles
  // anything only when no desktop window is attached.
  const declarationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (declarationTimerRef.current) {
        clearTimeout(declarationTimerRef.current)
      }
    },
    [],
  )
  const onResize = useCallback(
    async (cols: number, rows: number) => {
      if (declarationTimerRef.current) {
        clearTimeout(declarationTimerRef.current)
      }
      declarationTimerRef.current = setTimeout(() => {
        declarationTimerRef.current = null
        resizeTabWss(tabId, cols, rows)
      }, VIEWPORT_DECLARATION_DEBOUNCE_MS)
    },
    [tabId],
  )

  const onKey = useCallback((seq: string) => {
    sendInputRef.current(seq)
  }, [])

  const toggleCtrl = useCallback(() => setCtrlArmed((v) => !v), [])
  const toggleAlt = useCallback(() => setAltArmed((v) => !v), [])

  const connected = useStore($session).status === 'connected'
  const writeToTerminal = useCallback((payload: string) => {
    terminalRef.current?.write(payload)
  }, [])
  useConnectionNotices(tabId, writeToTerminal)

  const info = useActiveTabInfo(projectId, tabId)
  const closedTab = useClosedTab(projectId, tabId)
  // A tab the tree has dropped keeps the name it had, not its raw id.
  const active = { ...info, label: closedTab.label ?? info.label }
  useNoteRecency(tabId)

  return {
    terminalRef,
    onData,
    onResize,
    onReady,
    onOpenUrl,
    onKey,
    ctrlArmed,
    altArmed,
    toggleCtrl,
    toggleAlt,
    active,
    connected,
    closedTab,
  }
}
