import Constants from 'expo-constants'
import { Platform } from 'react-native'
import type { DeviceRecord } from '@/modules/stores/$devices'
import { saveDeviceToSecureStore } from '@/modules/stores/$devices'
import { type Route, routeOfHost } from '@/modules/wss/route.helpers'
import { deviceFriendlyName } from '../../../modules/device-name'
import { PinnedWebSocket } from '../../../modules/pinned-websocket'
import {
  buildPairingAttemptUrls,
  CanceledError,
  type Dial,
  PAIRING_CONNECT_CAP_MS,
  type PairingRefusal,
  type PairTry,
  pairingRefusal,
  pairingUrlHost,
  parsePairingCompleteFrame,
  raceToFirstOpen,
  UnreachableError,
} from './pair.helpers'
import type { PairingQrPayload } from './pair.types'

/** How a pairing attempt ended without a paired device. */
export type PairFailure =
  /** The desktop answered no; final, whatever address answered. */
  | { kind: 'refused'; refusal: PairingRefusal; reason: string }
  /** No address in the QR answered within the cap. */
  | { kind: 'unreachable'; tries: PairTry[] }
  /** The connection dropped while the request was waiting for approval. */
  | { kind: 'interrupted' }

export class PairingFailed extends Error {
  constructor(readonly failure: PairFailure) {
    super(`pairing failed: ${failure.kind}`)
  }
}

/** What this phone sends about itself, and shows on the waiting sheet. */
export interface DeviceMeta {
  device_name: string
  platform: string
  model: string | null
}

export interface WaitingInfo {
  startedAt: number
  route: Route
  host: string
  meta: DeviceMeta
}

export interface PairingCallbacks {
  /** Aborting ends the attempt at once and withdraws the request. */
  signal: AbortSignal
  /** The addresses being tried, on every change. */
  onReaching: (tries: PairTry[]) => void
  /** The desktop accepted the token and is asking its user. */
  onWaiting: (info: WaitingInfo) => void
}

/**
 * Pair with the desktop a scanned QR names.
 *
 * Every address in the QR is dialled at once and the first to open is
 * kept (see `raceToFirstOpen`); reaching the desktop and getting its
 * answer to the pairing token share one 15 s cap. Any `auth_fail` from
 * the desktop is final: it was reached and said no, so no other address
 * is tried. Then the desktop asks its user, which the desktop bounds to
 * 60 s; the phone counts the same minute down.
 *
 * Rejects with {@link PairingFailed} or {@link CanceledError}; resolves
 * with the persisted record.
 */
export async function completePairing(
  qr: PairingQrPayload,
  callbacks: PairingCallbacks,
): Promise<DeviceRecord> {
  const urls = buildPairingAttemptUrls(qr)
  const deadline = Date.now() + PAIRING_CONNECT_CAP_MS
  let won: Awaited<ReturnType<typeof raceToFirstOpen<PinnedWebSocket>>>
  try {
    won = await raceToFirstOpen(urls, pinnedDial(qr.fingerprint), {
      capMs: PAIRING_CONNECT_CAP_MS,
      signal: callbacks.signal,
      onUpdate: callbacks.onReaching,
    })
  } catch (e) {
    if (e instanceof UnreachableError) {
      throw new PairingFailed({ kind: 'unreachable', tries: e.tries })
    }
    throw e
  }
  const host = pairingUrlHost(won.url) ?? won.url
  console.log(`[pair] reached the desktop via ${maskHost(host)}`)

  const meta = deviceMeta()
  const reply = await runPairingExchange(won.socket, qr.pairing_token, meta, {
    deadline,
    signal: callbacks.signal,
    onAccepted: () =>
      callbacks.onWaiting({
        startedAt: Date.now(),
        route: routeOfHost(host),
        host,
        meta,
      }),
    unreachable: () =>
      won.tries.map((t) =>
        t.host === host ? { ...t, state: 'no-answer' as const } : t,
      ),
  })

  const record: DeviceRecord = {
    token: reply.device_token,
    deviceId: reply.device_id,
    ips: qr.ips,
    port: qr.port,
    fingerprint: qr.fingerprint,
    deviceHint: qr.device_hint,
    // Seed the reconnect cache with the endpoint that just worked, not
    // the first enumerated address, which this phone may not reach.
    lastIp: host,
    lastPort: qr.port,
    ...(qr.host === undefined ? {} : { host: qr.host }),
    ...(qr.tailscale_host === undefined
      ? {}
      : { tailscaleHost: qr.tailscale_host }),
  }
  await saveDeviceToSecureStore(record)
  console.log(`[pair] paired via ${maskHost(host)}`)
  return record
}

/** Opens a pinned socket for `raceToFirstOpen`. */
function pinnedDial(fingerprint: string) {
  return (url: string): Dial<PinnedWebSocket> => {
    let ws: PinnedWebSocket | null = null
    const opened = new Promise<PinnedWebSocket>((resolve, reject) => {
      try {
        ws = new PinnedWebSocket(url, { fingerprint })
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
        return
      }
      const socket = ws
      socket.onopen = () => resolve(socket)
      socket.onerror = (event) => reject(new Error(event.message))
      socket.onclose = (event) => reject(new Error(`closed (${event.code})`))
    })
    return {
      opened,
      cancel: () => {
        try {
          ws?.close()
        } catch {
          /* already gone */
        }
      },
    }
  }
}

/**
 * Redact the host for logs: IPv4 addresses lose their first two octets,
 * names are kept (the QR shared them anyway).
 */
function maskHost(host: string): string {
  return host.replace(/^\d+\.\d+\./, 'x.x.')
}

interface PairingReply {
  device_token: string
  device_id: string
}

/**
 * The desktop's own approval limit is 60 s from pairing_start; this only
 * catches a desktop that never answers at all, so it is the desktop that
 * decides when an unanswered request ends.
 */
const APPROVAL_TIMEOUT_MS = 75_000

/**
 * Run the pairing handshake on an open socket: auth with the pairing
 * token, then pairing_start, then wait for pairing_complete.
 */
function runPairingExchange(
  ws: PinnedWebSocket,
  pairingToken: string,
  meta: DeviceMeta,
  opts: {
    deadline: number
    signal: AbortSignal
    onAccepted: () => void
    unreachable: () => PairTry[]
  },
): Promise<PairingReply> {
  return new Promise<PairingReply>((resolve, reject) => {
    let settled = false
    let accepted = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal.removeEventListener('abort', onAbort)
      fn()
      try {
        ws.close()
      } catch {
        /* already gone */
      }
    }
    const fail = (failure: PairFailure) =>
      done(() => reject(new PairingFailed(failure)))
    // Closing the socket is what withdraws the request on the desktop:
    // its prompt closes, and nothing is left there to approve.
    const onAbort = () => done(() => reject(new CanceledError()))
    let timer = setTimeout(
      () => fail({ kind: 'unreachable', tries: opts.unreachable() }),
      Math.max(0, opts.deadline - Date.now()),
    )
    if (opts.signal.aborted) {
      onAbort()
      return
    }
    opts.signal.addEventListener('abort', onAbort)

    ws.onmessage = (event) => {
      const complete = parsePairingCompleteFrame(event.data)
      if (complete) {
        done(() => resolve(complete))
        return
      }
      let frame: { op?: string; body?: { reason?: string } }
      try {
        frame = JSON.parse(event.data)
      } catch {
        return
      }
      if (frame.op === 'auth_fail') {
        const reason = String(frame.body?.reason ?? 'auth_fail')
        console.log(`[pair] the desktop refused: ${reason}`)
        fail({ kind: 'refused', refusal: pairingRefusal(reason), reason })
        return
      }
      if (frame.op === 'auth_ok' && !accepted) {
        accepted = true
        clearTimeout(timer)
        timer = setTimeout(
          () =>
            fail({
              kind: 'refused',
              refusal: 'timed-out',
              reason: 'no answer from the desktop',
            }),
          APPROVAL_TIMEOUT_MS,
        )
        ws.send(
          JSON.stringify({
            op: 'pairing_start',
            body: { op_id: 1, body: meta },
          }),
        )
        opts.onAccepted()
      }
    }
    const lost = () =>
      accepted
        ? fail({ kind: 'interrupted' })
        : fail({ kind: 'unreachable', tries: opts.unreachable() })
    ws.onerror = lost
    ws.onclose = lost

    ws.send(
      JSON.stringify({
        op: 'auth',
        body: { token: `PAIRING:${pairingToken}` },
      }),
    )
  })
}

/**
 * What the desktop is told about this phone. The name is the one its
 * owner gave it ("Galaxy M52 5G"); `Constants.deviceName` is the model
 * number on Android ("SM-M526B"), so it is only the fallback. The model
 * goes in its own field, so the desktop can show both.
 */
export function deviceMeta(): DeviceMeta {
  const platform =
    Platform.OS === 'ios'
      ? 'ios'
      : Platform.OS === 'android'
        ? 'android'
        : Platform.OS
  const constants = Platform.constants as { Model?: unknown }
  const model =
    Platform.OS === 'android' && typeof constants.Model === 'string'
      ? constants.Model
      : null
  return {
    device_name: deviceFriendlyName() ?? Constants.deviceName ?? 'Mobile',
    platform,
    model,
  }
}
