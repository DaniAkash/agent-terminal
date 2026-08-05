/**
 * QR payload the desktop encodes. Mirrors Rust-side `PairingQrPayload`
 * in `src-tauri/src/commands.rs`. Hand-maintained for now; a future
 * `#[typeshare]` sweep on the Rust struct can codegen this.
 */
export interface PairingQrPayload {
  v: number
  host?: string
  ips: string[]
  port: number
  fingerprint: string
  pairing_token: string
  device_hint: string
}

/**
 * `PairingComplete` server frame body shape from the wire protocol.
 * Duplicated tightly here so the pair-screen module doesn't grow a
 * cross-cutting dependency on the WSS bridge's generated types
 * (they live in `wss/protocol.gen.ts`; the pair screen imports them
 * directly at consumption time).
 */

/** Local error taxonomy so the UI can render distinct messages. */
export type PairError =
  | { kind: 'permission-denied' }
  | { kind: 'bad-qr'; reason: string }
  | { kind: 'connection-failed'; reason: string }
  | { kind: 'fingerprint-mismatch' }
  | { kind: 'pairing-token-expired' }
  | { kind: 'timeout' }
  | { kind: 'unknown'; reason: string }
