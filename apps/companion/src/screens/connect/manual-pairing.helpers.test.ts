import { describe, expect, test } from 'bun:test'
import { isDeviceRecord } from '@/modules/stores/$device.helpers'
import {
  deviceRecordFromManualInput,
  isIpv4Literal,
  normaliseFingerprint,
  parseManualEndpoint,
} from './manual-pairing.helpers'

describe('normaliseFingerprint', () => {
  test('accepts the shape openssl prints, prefix and all', () => {
    // A straight copy out of the terminal has to work. Retyping 32 hex
    // pairs is exactly where a pin gets mistyped, and a mistyped pin
    // invites someone to "fix" the mismatch by weakening the check.
    expect(
      normaliseFingerprint(
        'sha256 Fingerprint=03:0A:11:18:1F:26:2D:34:3B:42:49:50:57:5E:65:6C:73:7A:81:88:8F:96:9D:A4:AB:B2:B9:C0:C7:CE:D5:DC',
      ),
    ).toBe(
      '03:0A:11:18:1F:26:2D:34:3B:42:49:50:57:5E:65:6C:73:7A:81:88:8F:96:9D:A4:AB:B2:B9:C0:C7:CE:D5:DC',
    )
  })

  test('uppercases and re-groups a colonless lowercase blob', () => {
    expect(
      normaliseFingerprint(
        '030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc',
      ),
    ).toBe(
      '03:0A:11:18:1F:26:2D:34:3B:42:49:50:57:5E:65:6C:73:7A:81:88:8F:96:9D:A4:AB:B2:B9:C0:C7:CE:D5:DC',
    )
  })

  test('returns null for the wrong length', () => {
    expect(normaliseFingerprint('AB:CD')).toBeNull()
  })

  test('returns null for non-hex characters', () => {
    expect(
      normaliseFingerprint(
        'ZZ:51:10:28:21:5A:A6:05:CD:60:37:B0:BA:02:07:77:E2:E9:5C:1D:1D:C4:0F:F7:66:FB:19:CE:DF:A3:62:26',
      ),
    ).toBeNull()
  })
})

describe('parseManualEndpoint', () => {
  test('splits host and port out of a wss URL', () => {
    expect(parseManualEndpoint('wss://Lancer-7.local:28617/stream')).toEqual({
      host: 'lancer-7.local',
      port: 28617,
    })
  })

  test('returns null when the port is missing', () => {
    expect(parseManualEndpoint('wss://host/stream')).toBeNull()
  })

  test('returns null for a non-URL', () => {
    expect(parseManualEndpoint('not a url')).toBeNull()
  })
})

describe('isIpv4Literal', () => {
  test('true for a dotted quad', () => {
    expect(isIpv4Literal('192.168.0.79')).toBe(true)
  })

  test('false for a .local hostname, which belongs in host not ips', () => {
    expect(isIpv4Literal('Lancer-7.local')).toBe(false)
  })

  test('false for an out-of-range octet', () => {
    expect(isIpv4Literal('192.168.0.999')).toBe(false)
  })
})

describe('deviceRecordFromManualInput', () => {
  test('puts a bare IPv4 in ips, matching what the QR payload produces', () => {
    const r = deviceRecordFromManualInput(
      'wss://192.168.0.79:28617/stream',
      'tok',
      '03:0A:11:18:1F:26:2D:34:3B:42:49:50:57:5E:65:6C:73:7A:81:88:8F:96:9D:A4:AB:B2:B9:C0:C7:CE:D5:DC',
    )
    expect(r).toEqual({
      token: 'tok',
      deviceId: 'manual:192.168.0.79:28617',
      ips: ['192.168.0.79'],
      port: 28617,
      fingerprint:
        '03:0A:11:18:1F:26:2D:34:3B:42:49:50:57:5E:65:6C:73:7A:81:88:8F:96:9D:A4:AB:B2:B9:C0:C7:CE:D5:DC',
      deviceHint: 'manual connect',
      lastIp: '192.168.0.79',
      lastPort: 28617,
    })
  })

  test('puts a hostname in host and leaves ips empty', () => {
    const r = deviceRecordFromManualInput(
      'wss://Lancer-7.local:28617/stream',
      'tok',
      '03:0A:11:18:1F:26:2D:34:3B:42:49:50:57:5E:65:6C:73:7A:81:88:8F:96:9D:A4:AB:B2:B9:C0:C7:CE:D5:DC',
    )
    expect(r?.host).toBe('lancer-7.local')
    expect(r?.ips).toEqual([])
    expect(r?.lastIp).toBeNull()
  })

  test('returns null when the URL has no port to connect to', () => {
    expect(
      deviceRecordFromManualInput(
        'wss://host/stream',
        'tok',
        '03:0A:11:18:1F:26:2D:34:3B:42:49:50:57:5E:65:6C:73:7A:81:88:8F:96:9D:A4:AB:B2:B9:C0:C7:CE:D5:DC',
      ),
    ).toBeNull()
  })

  test('produces a record the persisted-shape guard accepts', () => {
    // The record is written straight to SecureStore and read back through
    // isDeviceRecord on the next boot; a field missed here would only
    // surface as a silent unpair much later.
    const r = deviceRecordFromManualInput(
      'wss://192.168.0.79:28617/stream',
      'tok',
      '03:0A:11:18:1F:26:2D:34:3B:42:49:50:57:5E:65:6C:73:7A:81:88:8F:96:9D:A4:AB:B2:B9:C0:C7:CE:D5:DC',
    )
    expect(isDeviceRecord(r)).toBe(true)
  })
})
