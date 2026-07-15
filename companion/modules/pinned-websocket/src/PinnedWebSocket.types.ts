export type PinnedWebSocketOpenEvent = { id: string }
export type PinnedWebSocketMessageEvent = { id: string; data: string }
export type PinnedWebSocketCloseEvent = { id: string; code: number; reason: string }
export type PinnedWebSocketErrorEvent = { id: string; message: string }

export type PinnedWebSocketModuleEvents = {
  onOpen: (event: PinnedWebSocketOpenEvent) => void
  onMessage: (event: PinnedWebSocketMessageEvent) => void
  onClose: (event: PinnedWebSocketCloseEvent) => void
  onError: (event: PinnedWebSocketErrorEvent) => void
}

export type PinnedWebSocketReadyState = 0 | 1 | 2 | 3

export interface PinnedWebSocketOptions {
  /**
   * Uppercase colon-separated hex SHA-256 of the server leaf cert's DER bytes.
   * Same format `openssl x509 -fingerprint -sha256` prints, minus the prefix.
   */
  fingerprint: string
}
