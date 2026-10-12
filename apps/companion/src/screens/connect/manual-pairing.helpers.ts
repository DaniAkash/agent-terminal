import type { DeviceRecord } from '@/modules/stores/$devices.types'

/**
 * Pure helpers for the manual (non-QR) pairing path. Split out of
 * `connect.helpers.ts` so neither file carries the whole connect surface:
 * these three exist only to turn hand-entered values into the
 * `DeviceRecord` the pinned socket requires.
 */

/**
 * Accept a SHA-256 fingerprint in the shape `openssl x509 -fingerprint
 * -sha256` prints, so a straight copy out of a terminal works: optional
 * `sha256 Fingerprint=` prefix, colon-separated hex pairs, any case,
 * surrounding whitespace. Returns the uppercase colon-separated form the
 * QR payload also carries, so both pairing paths persist an identical
 * representation and the pin comparison never has to care which one ran.
 *
 * Returns null when the input is not 32 hex pairs, which the form surfaces
 * as a validation error rather than failing later inside the socket.
 */
export function normaliseFingerprint(input: string): string | null {
  const body = input.trim().replace(/^sha256\s*fingerprint\s*=\s*/i, '')
  const hex = body.replace(/[\s:]/g, '').toUpperCase()
  if (!/^[0-9A-F]{64}$/.test(hex)) return null
  return (hex.match(/.{2}/g) ?? []).join(':')
}

/**
 * Canonicalise hand-entered input into the single URL this transport can
 * actually use: `wss://host:port/stream`.
 *
 * Strict on purpose. `PinnedWebSocket` rejects non-wss synchronously, and
 * the desktop serves only `/stream`, so a `ws://` scheme or a stray path
 * produces a record that saves cleanly and then fails to connect, or
 * connects once and resolves differently on the next attempt because the
 * resolver always rebuilds `/stream`. Rejecting here turns all of that
 * into one field error at submit time.
 *
 * A bare `host:port` is accepted and upgraded, since that is what the
 * desktop prints and what people paste.
 */
export function canonicalStreamUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z]+:\/\//i.test(trimmed)
    ? trimmed
    : `wss://${trimmed}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return null
  }
  if (u.protocol !== 'wss:') return null
  if (!u.hostname || !u.port) return null
  return `wss://${u.hostname}:${u.port}/stream`
}

/**
 * Split a `wss://host:port/path` URL into the endpoint fields a
 * DeviceRecord needs. Returns null for anything the resolver could not
 * later rebuild a URL from.
 */
export function parseManualEndpoint(
  url: string,
): { host: string; port: number } | null {
  try {
    const u = new URL(url)
    const port = Number(u.port)
    if (!u.hostname || !Number.isFinite(port) || port <= 0) return null
    return { host: u.hostname, port }
  } catch {
    return null
  }
}

/** True for a bare IPv4 literal, which belongs in `ips` rather than `host`. */
export function isIpv4Literal(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/**
 * Build the `DeviceRecord` the pinned socket requires from hand-entered
 * values. Returns null when the URL carries no usable host and port, which
 * the form reports against the URL field.
 *
 * A bare IPv4 goes in `ips` and a name goes in `host`, matching how the QR
 * payload populates the same record, so the resolver ladder behaves
 * identically whichever path produced it.
 */
export function deviceRecordFromManualInput(
  url: string,
  token: string,
  fingerprint: string,
): DeviceRecord | null {
  const endpoint = parseManualEndpoint(url)
  if (!endpoint) return null
  const isIp = isIpv4Literal(endpoint.host)
  return {
    token,
    deviceId: `manual:${endpoint.host}:${endpoint.port}`,
    ips: isIp ? [endpoint.host] : [],
    port: endpoint.port,
    fingerprint,
    deviceHint: 'manual connect',
    lastIp: isIp ? endpoint.host : null,
    lastPort: endpoint.port,
    ...(isIp ? {} : { host: endpoint.host }),
  }
}
