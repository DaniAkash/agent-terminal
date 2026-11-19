import { describe, expect, test } from 'bun:test'
import {
  addressLine,
  deviceLine,
  isCgnatIpv4,
  platformLabel,
  routeOfAddress,
} from './companion.helpers'

describe('routeOfAddress', () => {
  test('a tailnet address is Tailscale', () => {
    expect(routeOfAddress('100.64.0.7')).toBe('Tailscale')
    expect(routeOfAddress('100.127.255.1')).toBe('Tailscale')
    expect(routeOfAddress('::ffff:100.64.0.7')).toBe('Tailscale')
    expect(routeOfAddress('fd7a:115c:a1e0::1')).toBe('Tailscale')
  })

  test('anything else is Wi-Fi', () => {
    expect(routeOfAddress('192.168.0.24')).toBe('Wi-Fi')
    expect(routeOfAddress('10.0.0.42')).toBe('Wi-Fi')
    // Just outside 100.64.0.0/10 on both sides.
    expect(routeOfAddress('100.63.255.255')).toBe('Wi-Fi')
    expect(routeOfAddress('100.128.0.1')).toBe('Wi-Fi')
  })

  test('no address, no route', () => {
    expect(routeOfAddress(undefined)).toBeNull()
    expect(routeOfAddress('')).toBeNull()
  })
})

test('isCgnatIpv4 rejects what is not a dotted quad', () => {
  expect(isCgnatIpv4('100.64')).toBe(false)
  expect(isCgnatIpv4('desk.tail1234.ts.net')).toBe(false)
})

test('platform and device lines', () => {
  expect(platformLabel('android')).toBe('Android')
  expect(platformLabel('ios')).toBe('iOS')
  expect(deviceLine('android', 'SM-M526B')).toBe('SM-M526B · Android')
  expect(deviceLine('android')).toBe('Android')
  expect(addressLine('100.64.0.7')).toBe('100.64.0.7 · Tailscale')
  expect(addressLine('192.168.0.24')).toBe('192.168.0.24 · Wi-Fi')
  expect(addressLine(undefined)).toBeNull()
})
