// Shared types for the Companion pairing dialog. Kept in a satellite
// file so the button + dialog components can share them without a
// components-import-components cycle. The wire shapes are hand-mirrored
// from the Rust-side `PairingQrPayload` + `PairedDevice`; a future
// `#[typeshare]` sweep can codegen these if the drift becomes a
// maintenance problem.

/** JSON payload the desktop encodes into the pairing QR. */
export interface PairingQrPayload {
  v: number
  /** `.local` mDNS hostname; absent when hostname resolution failed. */
  host?: string
  /** Every RFC 1918 IPv4 the desktop is currently bound to. */
  ips: string[]
  /** Currently bound WSS port (one of 47823 / 28617 / 39482). */
  port: number
  /** SHA-256 of the WSS TLS cert, uppercase colon-hex. */
  fingerprint: string
  /** One-shot, 5-minute TTL server-side. */
  pairing_token: string
  /** Human label for the mobile side, e.g. "Dani's MacBook Pro". */
  device_hint: string
}

/** Snapshot of one paired device from the desktop's Keychain-backed map. */
export interface PairedDevice {
  id: string
  token_hash: string
  device_name: string
  platform: string
  model?: string
  paired_at: number
  last_seen: number
  last_ip?: string
}
