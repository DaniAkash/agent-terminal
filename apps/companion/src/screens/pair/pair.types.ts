/**
 * QR payload the desktop encodes. Mirrors Rust-side `PairingQrPayload`
 * in `src-tauri/src/commands.rs`. Hand-maintained for now; a future
 * `#[typeshare]` sweep on the Rust struct can codegen this.
 */
export interface PairingQrPayload {
  v: number
  host?: string
  tailscale_host?: string
  ips: string[]
  port: number
  fingerprint: string
  pairing_token: string
  device_hint: string
}

/** Failures before a pairing attempt starts, or outside its states. */
export type PairError =
  | { kind: 'permission-denied' }
  | { kind: 'bad-qr'; reason: string }
  | { kind: 'unknown'; reason: string }
