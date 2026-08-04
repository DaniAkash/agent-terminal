import type { Ref } from 'react'
import { useEffect, useImperativeHandle, useRef } from 'react'
import type { WebViewMessageEvent } from 'react-native-webview'
import { WebView } from 'react-native-webview'
import {
  buildTerminalHtml,
  DEFAULT_TERMINAL_HTML_CONFIG,
} from './terminal-html.helpers'

// Mirrors TerminalDom.tsx's imperative surface. Different underlying
// transport (native WebView vs Expo DOM Component), same public shape
// so TabScreen doesn't need per-platform logic.
export interface TerminalHandle {
  write: (data: string) => void
  clear: () => void
  fit: () => void
}

interface TerminalDomProps {
  onData: (data: string) => Promise<void>
  onResize: (cols: number, rows: number) => Promise<void>
  onReady: () => Promise<void>
  ref: Ref<TerminalHandle>
  // Accepted for shape parity with iOS. Only scrollEnabled is honoured
  // here; hideKeyboardAccessoryView is iOS-only and ignored on Android.
  dom?: { scrollEnabled?: boolean; hideKeyboardAccessoryView?: boolean }
}

const HTML = buildTerminalHtml(DEFAULT_TERMINAL_HTML_CONFIG)

type BridgeMessage =
  | { type: 'ready' }
  | { type: 'data'; payload: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'error'; message: string }

export default function TerminalDom({
  onData,
  onResize,
  onReady,
  ref,
  dom,
}: TerminalDomProps) {
  const webviewRef = useRef<WebView | null>(null)
  const readyRef = useRef(false)
  const pendingWritesRef = useRef<string[]>([])

  // Same ref-capture pattern as iOS. Keeps handler identity irrelevant
  // to WebView lifecycle so parent state changes (modifier toggles from
  // ExtraKeysBar) do not trigger unmount.
  //
  // Sync inside an effect (no deps → runs after every commit) instead of
  // direct render-time mutation so we stay safe against React's
  // concurrent-render replay semantics. One-render-cycle latency is
  // invisible because refs are only read from later-fired WebView
  // onMessage bridge callbacks, which happen after commit anyway.
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onDataRef.current = onData
    onResizeRef.current = onResize
    onReadyRef.current = onReady
  })

  useImperativeHandle(ref, () => ({
    write: (data: string) => {
      if (!readyRef.current) {
        pendingWritesRef.current.push(data)
        return
      }
      const payload = JSON.stringify(data)
      webviewRef.current?.injectJavaScript(
        `window.__terminal_bridge.write(${payload}); true;`,
      )
    },
    clear: () => {
      webviewRef.current?.injectJavaScript(
        `window.__terminal_bridge.clear(); true;`,
      )
    },
    fit: () => {
      webviewRef.current?.injectJavaScript(
        `window.__terminal_bridge.fit(); true;`,
      )
    },
  }))

  function drainPendingWrites(): void {
    const queued = pendingWritesRef.current
    pendingWritesRef.current = []
    for (const data of queued) {
      const payload = JSON.stringify(data)
      webviewRef.current?.injectJavaScript(
        `window.__terminal_bridge.write(${payload}); true;`,
      )
    }
  }

  // fallow-ignore-next-line complexity
  function handleMessage(event: WebViewMessageEvent): void {
    let msg: BridgeMessage
    try {
      msg = JSON.parse(event.nativeEvent.data) as BridgeMessage
    } catch (err) {
      console.error('[TerminalDom.android] parse error', err)
      return
    }
    if (msg.type === 'ready') {
      readyRef.current = true
      drainPendingWrites()
      void onReadyRef.current()
      return
    }
    if (msg.type === 'data') {
      void onDataRef.current(msg.payload)
      return
    }
    if (msg.type === 'resize') {
      void onResizeRef.current(msg.cols, msg.rows)
      return
    }
    if (msg.type === 'error') {
      console.error('[TerminalDom.android] boot error:', msg.message)
    }
  }

  return (
    <WebView
      ref={webviewRef}
      source={{ html: HTML, baseUrl: 'https://unpkg.com/' }}
      originWhitelist={['https://unpkg.com']}
      onMessage={handleMessage}
      onError={(e) =>
        console.error('[TerminalDom.android] webview error', e.nativeEvent)
      }
      onLoadEnd={() => console.log('[TerminalDom.android] webview loaded')}
      scrollEnabled={dom?.scrollEnabled ?? false}
      keyboardDisplayRequiresUserAction={false}
      androidLayerType="hardware"
    />
  )
}
