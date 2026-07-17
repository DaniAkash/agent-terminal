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

const SCROLLBACK = 2000

export function useTabData(tabId: string) {
  const session = useStore($session)
  const terminalRef = useRef<TerminalHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [ctrlArmed, setCtrlArmed] = useState(false)
  const [altArmed, setAltArmed] = useState(false)

  // Single funnel for input coming from either xterm.js's onData path
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
    })
    return () => {
      unsubscribeFromTab(tabId)
    }
  }, [tabId, ready])

  const onReady = useCallback(async () => {
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

  const toggleCtrl = useCallback(() => setCtrlArmed((v) => !v), [])
  const toggleAlt = useCallback(() => setAltArmed((v) => !v), [])

  return {
    terminalRef,
    onData,
    onResize,
    onReady,
    onKey,
    ctrlArmed,
    altArmed,
    toggleCtrl,
    toggleAlt,
    status: session.status,
    deviceName: session.deviceName,
  }
}
