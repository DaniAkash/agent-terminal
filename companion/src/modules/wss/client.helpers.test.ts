import { describe, expect, test } from 'bun:test'
import { computeBackoffDelay } from './client.helpers'

describe('computeBackoffDelay', () => {
  // Zero-jitter random for deterministic assertions on the exponential
  // branch; the fast-attempt branch (attempts 0 and 1) ignores random.
  const zeroRandom = () => 0
  const maxRandom = () => 0.9999

  test('first two attempts fire fast (250 ms, 500 ms) so foreground resume feels instant', () => {
    expect(computeBackoffDelay(0)).toBe(250)
    expect(computeBackoffDelay(1)).toBe(500)
  })

  test('fast attempts ignore the jitter source', () => {
    expect(computeBackoffDelay(0, { random: maxRandom })).toBe(250)
    expect(computeBackoffDelay(1, { random: maxRandom })).toBe(500)
  })

  test('exponential branch doubles each attempt from a 1 s base', () => {
    expect(computeBackoffDelay(2, { random: zeroRandom })).toBe(1_000)
    expect(computeBackoffDelay(3, { random: zeroRandom })).toBe(2_000)
    expect(computeBackoffDelay(4, { random: zeroRandom })).toBe(4_000)
    expect(computeBackoffDelay(5, { random: zeroRandom })).toBe(8_000)
    expect(computeBackoffDelay(6, { random: zeroRandom })).toBe(16_000)
  })

  test('caps at 30 s + jitter', () => {
    // 1000 * 2^(7-2) = 32000, capped to 30000. Plus jitter.
    expect(computeBackoffDelay(7, { random: zeroRandom })).toBe(30_000)
    expect(computeBackoffDelay(10, { random: zeroRandom })).toBe(30_000)
    expect(computeBackoffDelay(100, { random: zeroRandom })).toBe(30_000)
  })

  test('adds 0-249 ms of jitter on the exponential branch', () => {
    // Deterministic random source pinned at 0.5 yields exactly floor(125).
    const midRandom = () => 0.5
    expect(computeBackoffDelay(2, { random: midRandom })).toBe(1_125)
    expect(computeBackoffDelay(3, { random: midRandom })).toBe(2_125)
    // Upper edge: 0.9999 * 250 -> 249.
    expect(computeBackoffDelay(2, { random: maxRandom })).toBe(1_249)
    expect(computeBackoffDelay(7, { random: maxRandom })).toBe(30_249)
  })

  test('jitter is always in [0, 249]', () => {
    // Sample a chunk of the real Math.random source and verify every
    // exponential-branch delay lands in the expected band.
    for (let i = 0; i < 200; i++) {
      const d = computeBackoffDelay(2)
      expect(d).toBeGreaterThanOrEqual(1_000)
      expect(d).toBeLessThanOrEqual(1_249)
    }
  })
})
