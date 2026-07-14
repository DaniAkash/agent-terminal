import { describe, expect, it } from 'bun:test'
import {
  buildPairingAttemptUrls,
  formatFingerprintForVisualCompare,
  parsePairingCompleteFrame,
  parsePairingQr,
} from './pair.helpers'

describe('parsePairingQr', () => {
  const validPayload = {
    v: 1,
    host: 'danis-macbook.local',
    ips: ['192.168.1.42'],
    port: 47823,
    fingerprint: 'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90',
    pairing_token: '550e8400-e29b-41d4-a716-446655440000',
    device_hint: "Dani's MacBook Pro",
  }

  it('parses a well-formed JSON QR', () => {
    const parsed = parsePairingQr(JSON.stringify(validPayload))
    expect(parsed).not.toBeNull()
    expect(parsed?.pairing_token).toBe(validPayload.pairing_token)
    expect(parsed?.ips).toEqual(['192.168.1.42'])
  })

  it('accepts a payload without the optional host', () => {
    const { host: _drop, ...noHost } = validPayload
    const parsed = parsePairingQr(JSON.stringify(noHost))
    expect(parsed).not.toBeNull()
    expect(parsed?.host).toBeUndefined()
  })

  it('rejects a payload with the wrong version', () => {
    const bad = { ...validPayload, v: 2 }
    expect(parsePairingQr(JSON.stringify(bad))).toBeNull()
  })

  it('rejects a payload with a missing required field', () => {
    const bad = { ...validPayload, pairing_token: undefined }
    expect(parsePairingQr(JSON.stringify(bad))).toBeNull()
  })

  it('rejects arbitrary strings', () => {
    expect(parsePairingQr('')).toBeNull()
    expect(parsePairingQr('   ')).toBeNull()
    expect(parsePairingQr('not-json')).toBeNull()
    expect(parsePairingQr('{"unrelated": true}')).toBeNull()
  })

  it('accepts a base64-encoded JSON payload as a fallback', () => {
    const b64 = globalThis.btoa?.(JSON.stringify(validPayload))
    if (!b64) return // no btoa in this runtime; the code path is best-effort
    const parsed = parsePairingQr(b64)
    expect(parsed).not.toBeNull()
    expect(parsed?.pairing_token).toBe(validPayload.pairing_token)
  })
})

describe('buildPairingAttemptUrls', () => {
  const base = {
    v: 1,
    ips: ['192.168.1.42', '10.0.0.7'],
    port: 47823,
    fingerprint: 'AB',
    pairing_token: 'p',
    device_hint: 'D',
  }

  it('prefers .local host first when the QR carries one, with ws fallback per host', () => {
    const urls = buildPairingAttemptUrls({
      ...base,
      host: 'danis-macbook.local',
    })
    // .local first (wss then ws), then each IP (wss then ws).
    expect(urls).toEqual([
      'wss://danis-macbook.local:47823/stream',
      'ws://danis-macbook.local:47823/stream',
      'wss://192.168.1.42:47823/stream',
      'ws://192.168.1.42:47823/stream',
      'wss://10.0.0.7:47823/stream',
      'ws://10.0.0.7:47823/stream',
    ])
  })

  it('falls back to IP-only when no host is present', () => {
    const urls = buildPairingAttemptUrls(base)
    expect(urls).toEqual([
      'wss://192.168.1.42:47823/stream',
      'ws://192.168.1.42:47823/stream',
      'wss://10.0.0.7:47823/stream',
      'ws://10.0.0.7:47823/stream',
    ])
  })

  it('returns empty when the QR carries no addressable endpoint', () => {
    expect(buildPairingAttemptUrls({ ...base, ips: [] })).toEqual([])
  })
})

describe('parsePairingCompleteFrame', () => {
  it('extracts device_token + device_id from a valid frame', () => {
    const raw = JSON.stringify({
      op: 'pairing_complete',
      body: {
        op_id: 1,
        body: { device_token: 'tok', device_id: 'id' },
      },
    })
    expect(parsePairingCompleteFrame(raw)).toEqual({
      device_token: 'tok',
      device_id: 'id',
    })
  })

  it('returns null on the wrong op', () => {
    const raw = JSON.stringify({
      op: 'auth_ok',
      body: { body: { device_token: 'tok', device_id: 'id' } },
    })
    expect(parsePairingCompleteFrame(raw)).toBeNull()
  })

  it('returns null when a required field is missing', () => {
    const raw = JSON.stringify({
      op: 'pairing_complete',
      body: { op_id: 1, body: { device_token: 'tok' } },
    })
    expect(parsePairingCompleteFrame(raw)).toBeNull()
  })

  it('returns null on unparseable JSON', () => {
    expect(parsePairingCompleteFrame('not-json')).toBeNull()
    expect(parsePairingCompleteFrame('')).toBeNull()
  })
})

describe('formatFingerprintForVisualCompare', () => {
  it('groups a full 32-pair SHA-256 into 4-pair blocks', () => {
    const fp = Array.from({ length: 32 }, (_, i) =>
      i.toString(16).padStart(2, '0').toUpperCase(),
    ).join(':')
    const formatted = formatFingerprintForVisualCompare(fp)
    // 8 blocks × 4 pairs = 32 pairs total; joined by double space.
    const blocks = formatted.split('  ')
    expect(blocks).toHaveLength(8)
    // Every block is exactly 4 pairs (11 chars: 4 hex-pairs + 3 colons).
    for (const b of blocks) {
      expect(b.split(':')).toHaveLength(4)
    }
  })

  it('handles a shorter fingerprint gracefully', () => {
    const fp = 'AB:CD:EF:12:34:56'
    expect(formatFingerprintForVisualCompare(fp)).toBe('AB:CD:EF:12  34:56')
  })

  it('returns an empty string for an empty input', () => {
    expect(formatFingerprintForVisualCompare('')).toBe('')
  })
})
