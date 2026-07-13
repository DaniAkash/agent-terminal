import { describe, expect, it } from 'bun:test'
import type { DeviceRecord } from '@/modules/stores/$device'
import { classifyRung, resolveWssCandidates } from './resolver'

function fakeDevice(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    token: 't',
    deviceId: 'd',
    host: 'danis-macbook.local',
    ips: ['192.168.1.42', '10.0.0.7'],
    port: 47823,
    fingerprint: 'AB:CD',
    deviceHint: 'Desktop',
    lastIp: '192.168.1.42',
    lastPort: 47823,
    ...overrides,
  }
}

describe('resolveWssCandidates', () => {
  it('rung 1 places the cached IP + cached port first', () => {
    const candidates = resolveWssCandidates(fakeDevice())
    expect(candidates[0]).toBe('wss://192.168.1.42:47823/stream')
  })

  it('rung 2 uses the .local host on the cached port', () => {
    const candidates = resolveWssCandidates(fakeDevice())
    expect(candidates[1]).toBe('wss://danis-macbook.local:47823/stream')
  })

  it('rung 3 tries the .local host on each other standard port', () => {
    const candidates = resolveWssCandidates(fakeDevice())
    // After rungs 1+2, expect .local on the two remaining standard ports.
    const localOtherPorts = candidates
      .slice(2)
      .filter((c) => c.startsWith('wss://danis-macbook.local:'))
    expect(localOtherPorts).toEqual([
      'wss://danis-macbook.local:28617/stream',
      'wss://danis-macbook.local:39482/stream',
    ])
  })

  it('rung 4 falls back to every IP on every standard port', () => {
    const candidates = resolveWssCandidates(fakeDevice())
    // Second IP + a non-primary port must appear somewhere after the
    // .local rungs.
    expect(candidates).toContain('wss://10.0.0.7:28617/stream')
    expect(candidates).toContain('wss://10.0.0.7:39482/stream')
  })

  it('deduplicates URLs across rungs', () => {
    const candidates = resolveWssCandidates(fakeDevice())
    const unique = new Set(candidates)
    expect(unique.size).toBe(candidates.length)
  })

  it('handles a device with no .local host', () => {
    const { host: _drop, ...noHost } = fakeDevice()
    const candidates = resolveWssCandidates(noHost as DeviceRecord)
    // Only IP-based rungs should surface; no `.local` URLs.
    expect(candidates.every((c) => !c.includes('.local'))).toBe(true)
    // Cached path still first.
    expect(candidates[0]).toBe('wss://192.168.1.42:47823/stream')
  })

  it('handles a device with no cached lastIp yet', () => {
    const candidates = resolveWssCandidates(
      fakeDevice({ lastIp: null, lastPort: null }),
    )
    // First candidate should be primary IP on primary port from the QR.
    expect(candidates[0]).toBe('wss://192.168.1.42:47823/stream')
  })
})

describe('classifyRung', () => {
  it('labels the first candidate as `cached`', () => {
    const dev = fakeDevice()
    const first = resolveWssCandidates(dev)[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    expect(classifyRung(dev, first)).toBe('cached')
  })

  it('labels the .local + cached-port candidate as `local`', () => {
    const dev = fakeDevice()
    expect(classifyRung(dev, 'wss://danis-macbook.local:47823/stream')).toBe(
      'local',
    )
  })

  it('labels other .local candidates as `standard-port`', () => {
    const dev = fakeDevice()
    expect(classifyRung(dev, 'wss://danis-macbook.local:28617/stream')).toBe(
      'standard-port',
    )
  })

  it('labels IP-based fallbacks as `ip-fallback`', () => {
    const dev = fakeDevice()
    expect(classifyRung(dev, 'wss://10.0.0.7:28617/stream')).toBe('ip-fallback')
  })

  it('labels URLs outside the ladder as `unknown`', () => {
    const dev = fakeDevice()
    expect(classifyRung(dev, 'wss://something-else:1234/stream')).toBe(
      'unknown',
    )
  })
})
