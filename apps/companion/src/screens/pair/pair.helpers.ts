import type { PairingQrPayload } from './pair.types'

/**
 * Build the sequence of pairing URLs the mobile tries against a
 * scanned QR. Prefers the `.local` hostname first because it survives
 * IP shifts, then walks the primary + secondary IPs. Every candidate
 * is `wss://` because the native PinnedWebSocket rejects any other
 * scheme; there is no cleartext fallback.
 *
 * Returns an empty array when the QR carries no addressable endpoint
 * (defensive; the server always populates at least one field).
 */
export function buildPairingAttemptUrls(qr: PairingQrPayload): string[] {
  const urls: string[] = []
  const hosts: string[] = []
  if (qr.host) hosts.push(qr.host)
  for (const ip of qr.ips) hosts.push(ip)
  for (const host of hosts) {
    urls.push(`wss://${host}:${qr.port}/stream`)
  }
  return urls
}

/**
 * Parse the JSON body of a `pairing_complete` server frame. Returns
 * null when the shape is wrong so the caller can raise a distinct
 * error (rather than treating a malformed reply as a socket close).
 */
export function parsePairingCompleteFrame(raw: string): {
  device_token: string
  device_id: string
} | null {
  try {
    const frame = JSON.parse(raw)
    if (frame?.op !== 'pairing_complete') return null
    const body = frame.body?.body
    if (
      !body ||
      typeof body.device_token !== 'string' ||
      typeof body.device_id !== 'string'
    ) {
      return null
    }
    return { device_token: body.device_token, device_id: body.device_id }
  } catch {
    return null
  }
}

/**
 * Parse a QR scan payload. Accepts either a JSON string (current
 * shape) or a base64-encoded JSON string (reserved for future
 * versions when the payload grows past QR-friendly text length).
 * Returns null when the payload is not our v1 shape.
 */
export function parsePairingQr(raw: string): PairingQrPayload | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const attempts: string[] = [trimmed]
  // Best-effort base64 decode as a fallback.
  try {
    const decoded = globalThis.atob?.(trimmed)
    if (decoded) attempts.push(decoded)
  } catch {
    // not base64; ignore
  }
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate)
      if (isPairingPayload(parsed)) return parsed
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

function isPairingPayload(value: unknown): value is PairingQrPayload {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.v !== 1) return false
  if (typeof v.port !== 'number') return false
  if (typeof v.fingerprint !== 'string') return false
  if (typeof v.pairing_token !== 'string') return false
  if (typeof v.device_hint !== 'string') return false
  if (!Array.isArray(v.ips)) return false
  if (!v.ips.every((ip): ip is string => typeof ip === 'string')) return false
  if (v.host !== undefined && typeof v.host !== 'string') return false
  return true
}

/**
 * Format the SHA-256 fingerprint into groups of four hex-pair blocks
 * so it's easier to visually compare with the desktop. `openssl x509
 * -fingerprint -sha256` shape (`AB:CD:...`) already groups into
 * hex pairs; we insert extra whitespace every 4 pairs.
 */
export function formatFingerprintForVisualCompare(fp: string): string {
  const parts = fp.split(':')
  const chunks: string[] = []
  for (let i = 0; i < parts.length; i += 4) {
    chunks.push(parts.slice(i, i + 4).join(':'))
  }
  return chunks.join('  ')
}
