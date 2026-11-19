import { type Route, routeOfHost } from '@/modules/wss/route.helpers'
import type { PairingQrPayload } from './pair.types'

/**
 * Longest one pairing attempt spends reaching the desktop: every address
 * in the QR together, from Confirm until the desktop has accepted the
 * pairing token. Waiting for a person to approve is not part of it; the
 * desktop's own 60 s limit ends that.
 */
export const PAIRING_CONNECT_CAP_MS = 15_000

/**
 * Build the pairing URLs the mobile tries against a scanned QR: the
 * Tailscale name, the `.local` name, then every address. They are tried
 * together, not in turn (see {@link raceToFirstOpen}). Every candidate
 * is `wss://` because the native PinnedWebSocket rejects any other
 * scheme; there is no cleartext fallback.
 *
 * Returns an empty array when the QR carries no addressable endpoint
 * (defensive; the server always populates at least one field).
 */
export function buildPairingAttemptUrls(qr: PairingQrPayload): string[] {
  const urls: string[] = []
  const hosts: string[] = []
  // Tailscale MagicDNS and IPs connect directly across mesh
  if (qr.tailscale_host) hosts.push(qr.tailscale_host)
  if (qr.host) hosts.push(qr.host)
  for (const ip of qr.ips) hosts.push(ip)
  for (const host of hosts) {
    urls.push(`wss://${host}:${qr.port}/stream`)
  }
  return urls
}

/**
 * Host part of a `wss://<host>:<port>/stream` pairing URL, as built by
 * {@link buildPairingAttemptUrls}. Null when the URL has another shape.
 */
export function pairingUrlHost(url: string): string | null {
  return /^wss:\/\/(.+):\d+\/stream$/.exec(url)?.[1] ?? null
}

/** Why the desktop refused a pairing request, in the design's names. */
export type PairingRefusal =
  /** Decline on the desktop. */
  | 'declined'
  /** The dialog was closed (or a newer request replaced this one). */
  | 'canceled'
  /** Nobody answered within the desktop's 60 s. */
  | 'timed-out'
  /** The QR's token is no longer the open window's: QR expired. */
  | 'expired'
  /** Any other answer from the desktop. */
  | 'refused'

/**
 * Read an `auth_fail` reason from a pairing attempt.
 *
 * Every `auth_fail` is the desktop's final answer: it was reached and it
 * said no, so the attempt ends there and no other address is tried. Each
 * further attempt would only meet the same answer, or raise a fresh
 * approval prompt for a request the user already settled. The desktop
 * prefixes the approval outcomes with a code (`wss_server.rs`
 * `pairing_flow`); the window errors are plain text.
 */
export function pairingRefusal(reason: string): PairingRefusal {
  const code = /pairing_(declined|timeout|canceled)\b/.exec(reason)?.[1]
  if (code === 'declined') return 'declined'
  if (code === 'canceled') return 'canceled'
  if (code === 'timeout') return 'timed-out'
  if (/token mismatch|no pairing window|window expired/i.test(reason)) {
    return 'expired'
  }
  return 'refused'
}

/** One address of the QR as the Reaching sheet shows it. */
export interface PairTry {
  host: string
  route: Route
  state: 'connecting' | 'no-answer' | 'connected'
}

/** The addresses being tried, all connecting, in QR order. */
export function initialTries(urls: readonly string[]): PairTry[] {
  return urls.map((url) => {
    const host = pairingUrlHost(url) ?? url
    return { host, route: routeOfHost(host), state: 'connecting' }
  })
}

/** A socket being opened, as {@link raceToFirstOpen} drives it. */
export interface Dial<S> {
  /** Resolves when the socket is open; rejects when it cannot be. */
  opened: Promise<S>
  /** Give up on this socket: close it, open or not. */
  cancel: () => void
}

/** Every address failed, or none answered within the cap. */
export class UnreachableError extends Error {
  constructor(readonly tries: PairTry[]) {
    super('no address in the QR answered')
  }
}

/** The person canceled the attempt. */
export class CanceledError extends Error {
  constructor() {
    super('pairing canceled on this phone')
  }
}

/**
 * Open every URL at once and keep the first socket that opens; the rest
 * are closed. Rejects with {@link UnreachableError} when all of them fail
 * or `capMs` passes first, and with {@link CanceledError} when `signal`
 * aborts. `onUpdate` sees each change to the per-address state.
 *
 * Racing instead of walking is what keeps an attempt inside the cap: run
 * 3's QR carried 15 addresses at 10 s each, two and a half minutes of
 * "Pairing with…" for a desktop that had answered on the first.
 */
export function raceToFirstOpen<S>(
  urls: readonly string[],
  dial: (url: string) => Dial<S>,
  options: {
    capMs: number
    signal?: AbortSignal
    onUpdate?: (tries: PairTry[]) => void
  },
): Promise<{ url: string; socket: S; tries: PairTry[] }> {
  return new Promise((resolve, reject) => {
    const tries = initialTries(urls)
    const dials: Dial<S>[] = []
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const cancelAll = (except?: Dial<S>) => {
      for (const d of dials) if (d !== except) d.cancel()
    }
    const update = (i: number, state: PairTry['state']) => {
      const t = tries[i]
      if (t) tries[i] = { ...t, state }
      options.onUpdate?.([...tries])
    }
    const onAbort = () =>
      finish(() => {
        cancelAll()
        reject(new CanceledError())
      })
    const timer = setTimeout(
      () =>
        finish(() => {
          cancelAll()
          const ended = tries.map((t) =>
            t.state === 'connecting'
              ? { ...t, state: 'no-answer' as const }
              : t,
          )
          reject(new UnreachableError(ended))
        }),
      options.capMs,
    )
    if (options.signal?.aborted) {
      onAbort()
      return
    }
    options.signal?.addEventListener('abort', onAbort)
    if (urls.length === 0) {
      finish(() => reject(new UnreachableError([])))
      return
    }
    urls.forEach((url, i) => {
      const d = dial(url)
      dials.push(d)
      d.opened.then(
        (socket) => {
          if (settled) {
            d.cancel()
            return
          }
          update(i, 'connected')
          finish(() => {
            cancelAll(d)
            resolve({ url, socket, tries: [...tries] })
          })
        },
        () => {
          if (settled) return
          update(i, 'no-answer')
          if (tries.every((t) => t.state === 'no-answer')) {
            finish(() => reject(new UnreachableError([...tries])))
          }
        },
      )
    })
  })
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
  if (v.tailscale_host !== undefined && typeof v.tailscale_host !== 'string')
    return false
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

/**
 * Whether to offer push right after pairing.
 *
 * This is the only moment the ask makes sense: the user has just
 * connected a desktop, so the reason is obvious and the value is
 * immediate. At boot they have no desktop, cannot tell why the app
 * wants notifications, and deny, after which
 * `requestPermissionsAsync` never prompts again.
 *
 * Skipped when the device cannot receive push at all, and when the
 * permission is already settled either way: a second prompt is a
 * no-op the user still has to dismiss.
 */
export function shouldOfferPush(push: {
  support: 'unknown' | 'unsupported' | 'ok'
  permission: 'undetermined' | 'granted' | 'denied'
}): boolean {
  if (push.support === 'unsupported') return false
  return push.permission === 'undetermined'
}
