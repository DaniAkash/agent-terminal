import { describe, expect, it } from 'bun:test'
import { isDeviceRecord } from './$device.helpers'

function base() {
  return {
    token: 't',
    deviceId: 'd',
    ips: ['192.168.1.42'],
    port: 47823,
    fingerprint: 'AB',
    deviceHint: 'Desktop',
    lastIp: '192.168.1.42' as string | null,
    lastPort: 47823 as number | null,
  }
}

describe('isDeviceRecord', () => {
  it('accepts a well-formed record', () => {
    expect(isDeviceRecord(base())).toBe(true)
  })

  it('accepts a record with an optional host', () => {
    expect(isDeviceRecord({ ...base(), host: 'x.local' })).toBe(true)
  })

  it('accepts null lastIp / lastPort (fresh pair)', () => {
    expect(isDeviceRecord({ ...base(), lastIp: null, lastPort: null })).toBe(
      true,
    )
  })

  it('rejects non-objects', () => {
    expect(isDeviceRecord(null)).toBe(false)
    expect(isDeviceRecord(undefined)).toBe(false)
    expect(isDeviceRecord('string')).toBe(false)
    expect(isDeviceRecord(42)).toBe(false)
  })

  it('rejects missing required fields', () => {
    const { token: _t, ...noToken } = base()
    expect(isDeviceRecord(noToken)).toBe(false)
    const { deviceId: _d, ...noId } = base()
    expect(isDeviceRecord(noId)).toBe(false)
    const { port: _p, ...noPort } = base()
    expect(isDeviceRecord(noPort)).toBe(false)
  })

  it('rejects empty string ids that would break auth', () => {
    expect(isDeviceRecord({ ...base(), token: '' })).toBe(false)
    expect(isDeviceRecord({ ...base(), deviceId: '' })).toBe(false)
  })

  it('rejects wrong-typed fields', () => {
    expect(isDeviceRecord({ ...base(), port: '47823' })).toBe(false)
    expect(isDeviceRecord({ ...base(), ips: '192.168.1.42' })).toBe(false)
    expect(isDeviceRecord({ ...base(), ips: [1, 2, 3] })).toBe(false)
    expect(isDeviceRecord({ ...base(), fingerprint: null })).toBe(false)
  })

  it('rejects NaN / Infinity ports', () => {
    expect(isDeviceRecord({ ...base(), port: Number.NaN })).toBe(false)
    expect(isDeviceRecord({ ...base(), port: Number.POSITIVE_INFINITY })).toBe(
      false,
    )
  })
})
