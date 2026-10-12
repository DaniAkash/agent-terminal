import { describe, expect, test } from 'bun:test'
import type { DeviceRecord } from '@/modules/stores/$devices.types'
import { desktopRows, endpointOf } from './desktops.helpers'

function record(id: string, extra: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    token: 't',
    deviceId: id,
    ips: ['192.168.0.10'],
    port: 28617,
    fingerprint: 'f',
    deviceHint: id,
    lastIp: null,
    lastPort: null,
    ...extra,
  }
}

describe('desktopRows', () => {
  test('puts the desktop being driven first', () => {
    const rows = desktopRows({ a: record('a'), b: record('b') }, 'b')
    expect(rows.map((r) => r.deviceId)).toEqual(['b', 'a'])
    expect(rows[0]?.isActive).toBe(true)
  })

  test('orders the rest by name so the list does not shuffle', () => {
    const rows = desktopRows(
      { c: record('c'), a: record('a'), b: record('b') },
      null,
    )
    expect(rows.map((r) => r.deviceId)).toEqual(['a', 'b', 'c'])
  })

  test('falls back through hint, host, then id for a name', () => {
    const rows = desktopRows(
      { a: record('a', { deviceHint: '', host: 'studio.local' }) },
      null,
    )
    expect(rows[0]?.name).toBe('studio.local')
  })

  test('is empty when nothing is paired', () => {
    expect(desktopRows({}, null)).toEqual([])
  })
})

describe('endpointOf', () => {
  test('prefers the endpoint that actually worked last time', () => {
    const r = record('a', {
      host: 'studio.local',
      lastIp: '10.0.0.4',
      lastPort: 9999,
    })
    expect(endpointOf(r)).toBe('10.0.0.4:9999')
  })

  test('falls back to the advertised host, then to an advertised ip', () => {
    expect(endpointOf(record('a', { host: 'studio.local' }))).toBe(
      'studio.local:28617',
    )
    expect(endpointOf(record('a'))).toBe('192.168.0.10:28617')
  })

  test('is empty rather than malformed when there is nothing to show', () => {
    expect(endpointOf(record('a', { ips: [] }))).toBe('')
  })
})
