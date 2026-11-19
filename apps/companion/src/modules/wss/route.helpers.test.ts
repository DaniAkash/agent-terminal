import { describe, expect, test } from 'bun:test'
import { hostOfUrl, routeLabel, routeOfHost, routeOfUrl } from './route.helpers'

describe('routeOfHost', () => {
  test('a MagicDNS name is Tailscale', () => {
    expect(routeOfHost('desk.tail1234.ts.net')).toBe('tailscale')
    expect(routeOfHost('Desk.Tail1234.TS.NET.')).toBe('tailscale')
  })

  test('an address in 100.64.0.0/10 is Tailscale', () => {
    expect(routeOfHost('100.101.102.103')).toBe('tailscale')
    expect(routeOfHost('100.64.0.1')).toBe('tailscale')
    expect(routeOfHost('100.127.255.254')).toBe('tailscale')
  })

  test('local names and addresses are Wi-Fi', () => {
    expect(routeOfHost('desk.local')).toBe('wifi')
    expect(routeOfHost('10.0.0.42')).toBe('wifi')
    expect(routeOfHost('192.168.0.24')).toBe('wifi')
    // Either side of the tailnet range.
    expect(routeOfHost('100.63.0.1')).toBe('wifi')
    expect(routeOfHost('100.128.0.1')).toBe('wifi')
    // A name that merely starts like an address.
    expect(routeOfHost('100.100.example.com')).toBe('wifi')
  })
})

describe('routeOfUrl', () => {
  test('reads the host out of a stream URL', () => {
    expect(routeOfUrl('wss://desk.tail1234.ts.net:28617/stream')).toBe(
      'tailscale',
    )
    expect(routeOfUrl('wss://10.0.0.42:28617/stream')).toBe('wifi')
    expect(hostOfUrl('wss://100.101.102.103:28617/stream')).toBe(
      '100.101.102.103',
    )
  })

  test('no URL, no route', () => {
    expect(routeOfUrl(null)).toBeNull()
    expect(routeOfUrl('not a url')).toBeNull()
  })
})

test('labels', () => {
  expect(routeLabel('tailscale')).toBe('Tailscale')
  expect(routeLabel('wifi')).toBe('Wi-Fi')
})
