import type { Ref } from 'react'
import { useImperativeHandle, useRef } from 'react'
import type { WebViewMessageEvent } from 'react-native-webview'
import { WebView } from 'react-native-webview'
import {
  type TerminalCallbacks,
  useTerminalCallbackRefs,
} from './terminal-callbacks.hooks'
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
  /** Drop focus so the next tap on the terminal can take it again. */
  blurInput: () => void
}

interface TerminalDomProps extends TerminalCallbacks {
  ref: Ref<TerminalHandle>
  // Accepted for shape parity with iOS, and ignored. Both of these are
  // iOS-only props: react-native-webview implements neither on Android, so
  // passing them here would read as configuration that does nothing.
  dom?: { scrollEnabled?: boolean; hideKeyboardAccessoryView?: boolean }
}

const HTML = buildTerminalHtml(DEFAULT_TERMINAL_HTML_CONFIG)

type BridgeMessage =
  | { type: 'ready' }
  | { type: 'data'; payload: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'openUrl'; url: string }
  | { type: 'error'; message: string }

export default function TerminalDom({
  onData,
  onResize,
  onReady,
  onOpenUrl,
  ref,
}: TerminalDomProps) {
  const webviewRef = useRef<WebView | null>(null)
  const readyRef = useRef(false)
  const pendingWritesRef = useRef<string[]>([])

  const {
    onData: onDataRef,
    onResize: onResizeRef,
    onReady: onReadyRef,
    onOpenUrl: onOpenUrlRef,
  } = useTerminalCallbackRefs({ onData, onResize, onReady, onOpenUrl })

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
    blurInput: () => {
      webviewRef.current?.injectJavaScript(
        `window.__terminal_bridge.blurInput(); true;`,
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
    if (msg.type === 'openUrl') {
      void onOpenUrlRef.current(msg.url)
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
      keyboardDisplayRequiresUserAction={false}
      androidLayerType="hardware"
      // Without this the WebView never calls
      // requestDisallowInterceptTouchEvent, so GestureHandlerRootView above
      // it can claim a vertical drag and the page's touch handler never runs.
      // That is why the terminal scrolled on iOS but not here: `scrollEnabled`
      // is an iOS-only prop and does nothing on Android.
      nestedScrollEnabled
    />
  )
}
