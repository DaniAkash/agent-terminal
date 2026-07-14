import Constants from 'expo-constants'
import { Platform } from 'react-native'
import type { DeviceRecord } from '@/modules/stores/$device'
import { saveDeviceToSecureStore } from '@/modules/stores/$device'
import {
  buildPairingAttemptUrls,
  parsePairingCompleteFrame,
} from './pair.helpers'
import type { PairingQrPayload } from './pair.types'

/**
 * Complete the pairing handshake against a desktop identified by the
 * scanned QR payload. Opens a `wss://` connection using the
 * fingerprint-verified endpoint, sends `Auth { token: "PAIRING:..." }`,
 * then `PairingStart { device_name, platform, model }`, waits for
 * `PairingComplete { device_token, device_id }`, and stashes the
 * resulting `DeviceRecord` in secure-store before resolving.
 *
 * Returns the persisted DeviceRecord so the caller can immediately
 * transition to the auto-connect flow.
 */
export async function completePairing(
  qr: PairingQrPayload,
): Promise<DeviceRecord> {
  // URL builder is a pure helper in pair.helpers so the branching is
  // testable without a WebSocket.
  const attempts = buildPairingAttemptUrls(qr)
  if (attempts.length === 0) {
    throw new Error('QR carried no addressable endpoint')
  }

  const meta = deviceMeta()
  const failures: string[] = []
  for (const url of attempts) {
    try {
      const token = await runPairingSocket(url, qr.pairing_token, meta)
      const record: DeviceRecord = {
        token: token.device_token,
        deviceId: token.device_id,
        ips: qr.ips,
        port: qr.port,
        fingerprint: qr.fingerprint,
        deviceHint: qr.device_hint,
        lastIp: qr.ips[0] ?? null,
        lastPort: qr.port,
        ...(qr.host === undefined ? {} : { host: qr.host }),
      }
      await saveDeviceToSecureStore(record)
      console.log(`[pair] success via ${maskUrl(url)}`)
      return record
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failures.push(`${maskUrl(url)}: ${msg}`)
      console.warn(`[pair] attempt failed at ${maskUrl(url)}: ${msg}`)
    }
  }
  // Include every attempted endpoint in the surfaced error so the UI
  // shows what actually went wrong per rung, not just the last one.
  throw new Error(
    failures.length > 0
      ? `pairing failed on every endpoint: ${failures.join('; ')}`
      : 'pairing failed on every endpoint',
  )
}

/**
 * Redact the host portion of a `wss://<host>:<port>/stream` URL for
 * user-facing error text: replaces IPv4 octets with `x` and keeps
 * `.local` names as-is (they are already human-readable and the QR
 * shared them anyway).
 */
function maskUrl(url: string): string {
  return url.replace(/\d+\.\d+\.\d+\.\d+/, (ip) =>
    ip
      .split('.')
      .map((_, i) => (i < 2 ? 'x' : _))
      .join('.'),
  )
}

interface PairingReply {
  device_token: string
  device_id: string
}

interface DeviceMeta {
  device_name: string
  platform: string
  model: string | null
}

/**
 * Open a WSS socket, send the auth + pairing frames, and resolve
 * with the minted device token. Bounded 15s total timeout so a
 * misbehaved server (or wrong URL) fails fast enough that the
 * next endpoint attempt still has budget.
 */
function runPairingSocket(
  url: string,
  pairingToken: string,
  meta: DeviceMeta,
): Promise<PairingReply> {
  return new Promise<PairingReply>((resolve, reject) => {
    let settled = false
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      ws.close()
      reject(new Error(`pairing timeout at ${url}`))
    }, 15_000)
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
      ws.close()
    }

    ws.onopen = () => {
      // Auth with the PAIRING: prefix. Server dispatches into its
      // pairing_flow sub-task on receipt.
      ws.send(
        JSON.stringify({
          op: 'auth',
          body: { token: `PAIRING:${pairingToken}` },
        }),
      )
    }
    ws.onmessage = (event) => {
      const raw = String(event.data)
      const complete = parsePairingCompleteFrame(raw)
      if (complete) {
        done(() => resolve(complete))
        return
      }
      let frame: { op?: string; body?: { reason?: string } }
      try {
        frame = JSON.parse(raw)
      } catch (e) {
        done(() => reject(e instanceof Error ? e : new Error(String(e))))
        return
      }
      if (frame.op === 'auth_fail') {
        done(() => reject(new Error(String(frame.body?.reason ?? 'auth_fail'))))
        return
      }
      if (frame.op === 'auth_ok') {
        // Send our metadata so the server can mint the token.
        ws.send(
          JSON.stringify({
            op: 'pairing_start',
            body: {
              op_id: 1,
              body: {
                device_name: meta.device_name,
                platform: meta.platform,
                model: meta.model,
              },
            },
          }),
        )
      }
    }
    ws.onerror = () => {
      done(() => reject(new Error(`socket error at ${url}`)))
    }
    ws.onclose = (event) => {
      if (settled) return
      done(() =>
        reject(
          new Error(`socket closed before pairing_complete: ${event.code}`),
        ),
      )
    }
  })
}

/**
 * Derive the metadata bundle the server persists at pairing time.
 * Values come from the OS via expo-constants; misses fall back to
 * generic strings so a device with an unusual `Constants` shape
 * still pairs.
 */
function deviceMeta(): DeviceMeta {
  const raw = Constants.deviceName ?? 'Mobile'
  const platform =
    Platform.OS === 'ios'
      ? 'ios'
      : Platform.OS === 'android'
        ? 'android'
        : Platform.OS
  return {
    device_name: raw,
    platform,
    model: null,
  }
}
