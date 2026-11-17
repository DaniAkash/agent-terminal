import { describe, expect, it, mock } from 'bun:test'
import {
  buildPairingAttemptUrls,
  CanceledError,
  formatFingerprintForVisualCompare,
  pairingRefusal,
  pairingUrlHost,
  parsePairingCompleteFrame,
  parsePairingQr,
  raceToFirstOpen,
  shouldOfferPush,
  UnreachableError,
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

  it('prefers .local host first when the QR carries one', () => {
    const urls = buildPairingAttemptUrls({
      ...base,
      host: 'danis-macbook.local',
    })
    expect(urls).toEqual([
      'wss://danis-macbook.local:47823/stream',
      'wss://192.168.1.42:47823/stream',
      'wss://10.0.0.7:47823/stream',
    ])
  })

  it('falls back to IP-only when no host is present', () => {
    const urls = buildPairingAttemptUrls(base)
    expect(urls).toEqual([
      'wss://192.168.1.42:47823/stream',
      'wss://10.0.0.7:47823/stream',
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

describe('shouldOfferPush', () => {
  it('offers once, right after pairing, when nothing is settled yet', () => {
    expect(shouldOfferPush({ support: 'ok', permission: 'undetermined' })).toBe(
      true,
    )
  })

  it('does not re-ask once the user has answered', () => {
    expect(shouldOfferPush({ support: 'ok', permission: 'granted' })).toBe(
      false,
    )
    expect(shouldOfferPush({ support: 'ok', permission: 'denied' })).toBe(false)
  })

  it('does not offer on a device that cannot receive push', () => {
    expect(
      shouldOfferPush({ support: 'unsupported', permission: 'undetermined' }),
    ).toBe(false)
  })
})

describe('pairingUrlHost', () => {
  it('returns the host of a pairing attempt URL', () => {
    expect(pairingUrlHost('wss://192.168.1.42:47823/stream')).toBe(
      '192.168.1.42',
    )
    expect(pairingUrlHost('wss://mac.tail1234.ts.net:28617/stream')).toBe(
      'mac.tail1234.ts.net',
    )
  })

  it('returns null for any other shape', () => {
    expect(pairingUrlHost('https://example.com/')).toBeNull()
  })
})

describe('pairingRefusal', () => {
  it('reads the code the desktop puts in its auth_fail reason', () => {
    expect(pairingRefusal('pairing_declined: the request was declined')).toBe(
      'declined',
    )
    expect(pairingRefusal('pairing_timeout: not approved in time')).toBe(
      'timed-out',
    )
    expect(pairingRefusal('pairing_canceled: window closed')).toBe('canceled')
  })

  it('names an old QR as expired, however the desktop worded it', () => {
    expect(pairingRefusal('pairing token mismatch')).toBe('expired')
    expect(pairingRefusal('no pairing window open on desktop')).toBe('expired')
    expect(pairingRefusal('pairing window expired, reopen on desktop')).toBe(
      'expired',
    )
  })

  it('every other answer is still a refusal, not a reason to retry', () => {
    expect(pairingRefusal('keychain write failed: denied')).toBe('refused')
    expect(pairingRefusal('pairing_start timeout: not received')).toBe(
      'refused',
    )
  })
})

/** A dial the test settles by hand. */
function manualDial() {
  let open: (s: string) => void = () => {}
  let fail: (e: Error) => void = () => {}
  const opened = new Promise<string>((res, rej) => {
    open = res
    fail = rej
  })
  // A dial nobody settles must not leave an unhandled rejection.
  opened.catch(() => {})
  const dial = { opened, cancel: mock(() => {}) }
  return { dial, open, fail }
}

/** One manual dial per URL, looked up by URL or by index. */
function dialsFor(urls: readonly string[]) {
  const dials = urls.map(() => manualDial())
  const at = (i: number) => {
    const d = dials[i]
    if (!d) throw new Error(`no dial ${i}`)
    return d
  }
  return { all: dials, at, dial: (u: string) => at(urls.indexOf(u)).dial }
}

describe('raceToFirstOpen', () => {
  const urls = [
    'wss://desk.tail1234.ts.net:28617/stream',
    'wss://10.0.0.42:28617/stream',
    'wss://100.101.102.103:28617/stream',
  ]

  it('keeps the first socket that opens and closes the rest', async () => {
    const dials = dialsFor(urls)
    const race = raceToFirstOpen(urls, dials.dial, {
      capMs: 15_000,
    })
    dials.at(2).open('third')
    const won = await race
    expect(won.url).toBe(urls[2] ?? '')
    expect(won.socket).toBe('third')
    expect(dials.at(0).dial.cancel).toHaveBeenCalled()
    expect(dials.at(1).dial.cancel).toHaveBeenCalled()
    expect(dials.at(2).dial.cancel).not.toHaveBeenCalled()
    expect(won.tries.map((t) => t.route)).toEqual([
      'tailscale',
      'wifi',
      'tailscale',
    ])
  })

  it('ends as soon as every address has failed', async () => {
    const dials = dialsFor(urls)
    const race = raceToFirstOpen(urls, dials.dial, {
      capMs: 15_000,
    })
    for (const d of dials.all) d.fail(new Error('refused'))
    const err = await race.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UnreachableError)
    expect((err as UnreachableError).tries.map((t) => t.state)).toEqual([
      'no-answer',
      'no-answer',
      'no-answer',
    ])
  })

  it('never runs past the cap, and closes what is still connecting', async () => {
    const dials = dialsFor(urls)
    const started = Date.now()
    const err = await raceToFirstOpen(urls, dials.dial, { capMs: 40 }).catch(
      (e: unknown) => e,
    )
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(err).toBeInstanceOf(UnreachableError)
    for (const d of dials.all) expect(d.dial.cancel).toHaveBeenCalled()
  })

  it('stops at once when the person cancels', async () => {
    const dials = dialsFor(urls)
    const abort = new AbortController()
    const race = raceToFirstOpen(urls, dials.dial, {
      capMs: 15_000,
      signal: abort.signal,
    })
    abort.abort()
    expect(await race.catch((e: unknown) => e)).toBeInstanceOf(CanceledError)
    for (const d of dials.all) expect(d.dial.cancel).toHaveBeenCalled()
  })

  it('reports each address as it changes', async () => {
    const dials = dialsFor(urls)
    const seen: string[][] = []
    const race = raceToFirstOpen(urls, dials.dial, {
      capMs: 15_000,
      onUpdate: (tries) => seen.push(tries.map((t) => t.state)),
    })
    dials.at(0).fail(new Error('no route'))
    await Promise.resolve()
    dials.at(1).open('lan')
    await race
    expect(seen).toEqual([
      ['no-answer', 'connecting', 'connecting'],
      ['no-answer', 'connected', 'connecting'],
    ])
  })
})
