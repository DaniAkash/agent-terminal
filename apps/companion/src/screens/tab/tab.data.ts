import { useStore } from '@nanostores/react'
import { decode } from 'js-base64'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  useConnectionNotices,
  useNoteRecency,
} from './tab.hooks'

const SCROLLBACK = 2000

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

  // Single funnel for input coming from xterm.js's onData path (soft
  // keyboard capture), the ExtraKeysBar's nav keys, or its quick-combo
  // buttons. Optionally applies any armed modifier, sends the byte
  // sequence over the WSS, then disarms either way. A quick-combo's byte
  // sequence is already exactly what was asked for — passing
  // `applyModifiers: false` skips re-applying ctrl/alt (which would let a
  // stray armed Alt silently turn a tapped "Ctrl+C" into Alt+Ctrl+C)
  // while still disarming, so an armed-but-unused modifier never leaks
  // into the next keystroke.
  //
  // Rewritten on every commit to close over the latest state; consumers
  // reach it through the ref so their callback identity stays stable.
  //
  // Sync inside an effect (no deps → runs after every commit) instead of
  // direct render-time mutation. Refs are only read from onData /
  // onKey which fire from user events after commit, so the one-render-
  // cycle latency between a state change (arm/disarm) and the next
  // input read is invisible.
  const sendInputRef = useRef<
    (seq: string, opts?: { applyModifiers?: boolean }) => void
  >(() => {})
  useEffect(() => {
    // fallow-ignore-next-line complexity
    sendInputRef.current = (seq, { applyModifiers = true } = {}) => {
      let out = seq
      if (applyModifiers) {
        if (ctrlArmed) out = applyCtrl(out)
        if (altArmed) out = applyAlt(out)
      }
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

  const onData = useCallback(async (data: string) => {
    sendInputRef.current(data)
  }, [])

  const onResize = useCallback(
    async (cols: number, rows: number) => {
      resizeTabWss(tabId, cols, rows)
    },
    [tabId],
  )

  const onKey = useCallback((seq: string) => {
    sendInputRef.current(seq)
  }, [])

  const sendCombo = useCallback((seq: string) => {
    sendInputRef.current(seq, { applyModifiers: false })
  }, [])

  const toggleCtrl = useCallback(() => setCtrlArmed((v) => !v), [])
  const toggleAlt = useCallback(() => setAltArmed((v) => !v), [])

  const connected = useStore($session).status === 'connected'
  const writeToTerminal = useCallback((payload: string) => {
    terminalRef.current?.write(payload)
  }, [])
  useConnectionNotices(tabId, writeToTerminal)

  const active = useActiveTabInfo(projectId, tabId)
  useNoteRecency(tabId)

  return {
    terminalRef,
    onData,
    onResize,
    onReady,
    onKey,
    sendCombo,
    ctrlArmed,
    altArmed,
    toggleCtrl,
    toggleAlt,
    active,
    connected,
  }
}
