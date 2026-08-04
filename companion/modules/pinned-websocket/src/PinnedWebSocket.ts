import PinnedWebSocketModule from './PinnedWebSocketModule'
import type {
  PinnedWebSocketCloseEvent,
  PinnedWebSocketErrorEvent,
  PinnedWebSocketMessageEvent,
  PinnedWebSocketOpenEvent,
  PinnedWebSocketOptions,
  PinnedWebSocketReadyState,
} from './PinnedWebSocket.types'

type Disposer = () => void

/**
 * Browser-WebSocket-compatible surface for the native pinned socket. The
 * native module is a singleton with one event bus, so every instance's
 * listener filters by the id returned from `connect`.
 */
export class PinnedWebSocket {
  static readonly CONNECTING: 0 = 0
  static readonly OPEN: 1 = 1
  static readonly CLOSING: 2 = 2
  static readonly CLOSED: 3 = 3

  readyState: PinnedWebSocketReadyState = PinnedWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null

  private id: string | null = null
  private disposers: Disposer[] = []
  private pendingSends: string[] = []

  constructor(url: string, options: PinnedWebSocketOptions) {
    if (!url.startsWith('wss://')) {
      throw new Error(`PinnedWebSocket only accepts wss:// URLs, got ${url}`)
    }
    if (!options.fingerprint) {
      throw new Error('PinnedWebSocket requires a non-empty fingerprint')
    }

    const openSub = PinnedWebSocketModule.addListener('onOpen', (event) =>
      this.handleOpen(event),
    )
    const messageSub = PinnedWebSocketModule.addListener('onMessage', (event) =>
      this.handleMessage(event),
    )
    const closeSub = PinnedWebSocketModule.addListener('onClose', (event) =>
      this.handleClose(event),
    )
    const errorSub = PinnedWebSocketModule.addListener('onError', (event) =>
      this.handleError(event),
    )
    this.disposers.push(
      () => openSub.remove(),
      () => messageSub.remove(),
      () => closeSub.remove(),
      () => errorSub.remove(),
    )

    PinnedWebSocketModule.connect(url, options.fingerprint)
      .then((id) => {
        this.id = id
      })
      .catch((error: unknown) => {
        this.readyState = PinnedWebSocket.CLOSED
        const message = error instanceof Error ? error.message : String(error)
        this.onerror?.({ message })
        this.dispose()
      })
  }

  send(text: string): void {
    if (!this.id || this.readyState === PinnedWebSocket.CONNECTING) {
      this.pendingSends.push(text)
      return
    }
    if (this.readyState !== PinnedWebSocket.OPEN) return
    PinnedWebSocketModule.send(this.id, text)
  }

  close(code: number = 1000, reason: string = ''): void {
    this.readyState = PinnedWebSocket.CLOSING
    if (this.id) {
      void PinnedWebSocketModule.close(this.id, code, reason)
    }
  }

  private handleOpen(event: PinnedWebSocketOpenEvent): void {
    if (event.id !== this.id) return
    this.readyState = PinnedWebSocket.OPEN
    this.onopen?.()
    this.flushPendingSends()
  }

  private handleMessage(event: PinnedWebSocketMessageEvent): void {
    if (event.id !== this.id) return
    this.onmessage?.({ data: event.data })
  }

  private handleClose(event: PinnedWebSocketCloseEvent): void {
    if (event.id !== this.id) return
    this.readyState = PinnedWebSocket.CLOSED
    this.onclose?.({ code: event.code, reason: event.reason })
    this.dispose()
  }

  private handleError(event: PinnedWebSocketErrorEvent): void {
    if (event.id !== this.id) return
    this.onerror?.({ message: event.message })
  }

  private flushPendingSends(): void {
    const id = this.id
    if (!id) return
    for (const text of this.pendingSends) PinnedWebSocketModule.send(id, text)
    this.pendingSends = []
  }

  private dispose(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
  }
}
