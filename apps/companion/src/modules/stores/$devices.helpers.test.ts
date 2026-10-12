import { describe, expect, it } from 'bun:test'
import {
  isDeviceRecord,
  isDevicesIndex,
  nextActiveId,
  reconcileIndex,
} from './$devices.helpers'

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

describe('isDevicesIndex', () => {
  it('accepts a well-formed index', () => {
    expect(isDevicesIndex({ ids: ['a', 'b'], activeId: 'a' })).toBe(true)
    expect(isDevicesIndex({ ids: [], activeId: null })).toBe(true)
  })

  it('rejects shapes that would strand the loader', () => {
    expect(isDevicesIndex(null)).toBe(false)
    expect(isDevicesIndex({ ids: 'a', activeId: null })).toBe(false)
    expect(isDevicesIndex({ ids: [1], activeId: null })).toBe(false)
    expect(isDevicesIndex({ ids: [''], activeId: null })).toBe(false)
    expect(isDevicesIndex({ ids: [], activeId: 7 })).toBe(false)
  })
})

describe('nextActiveId', () => {
  it('keeps the current active when a different device is removed', () => {
    expect(nextActiveId(['a', 'b'], 'b', 'a')).toBe('a')
  })

  it('falls to another paired desktop rather than to nothing', () => {
    expect(nextActiveId(['a', 'b'], 'a', 'a')).toBe('b')
  })

  it('returns null only when the last desktop goes', () => {
    expect(nextActiveId(['a'], 'a', 'a')).toBeNull()
  })
})

describe('reconcileIndex', () => {
  const rec = {
    token: 't',
    deviceId: 'a',
    ips: [],
    port: 1,
    fingerprint: 'f',
    deviceHint: 'h',
    lastIp: null,
    lastPort: null,
  }

  it('drops ids whose record failed to load', () => {
    const out = reconcileIndex(['a', 'ghost'], { a: rec }, 'a')
    expect(out.ids).toEqual(['a'])
    expect(out.activeId).toBe('a')
  })

  it('repoints the active id when it names a missing record', () => {
    const out = reconcileIndex(['ghost', 'a'], { a: rec }, 'ghost')
    expect(out.activeId).toBe('a')
  })

  it('yields no active device when nothing loaded', () => {
    const out = reconcileIndex(['ghost'], {}, 'ghost')
    expect(out.ids).toEqual([])
    expect(out.activeId).toBeNull()
  })
})
