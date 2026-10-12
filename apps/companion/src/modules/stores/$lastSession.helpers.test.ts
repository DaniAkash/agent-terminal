import { describe, expect, test } from 'bun:test'
import {
  forgetDevice,
  isLastSessionMap,
  rememberSession,
} from './$lastSession.helpers'

describe('isLastSessionMap', () => {
  test('accepts a map of device id to tab id', () => {
    expect(isLastSessionMap({ d1: 'p1:t1' })).toBe(true)
    expect(isLastSessionMap({})).toBe(true)
  })

  test('rejects shapes that would break the resolver', () => {
    expect(isLastSessionMap(null)).toBe(false)
    expect(isLastSessionMap([])).toBe(false)
    expect(isLastSessionMap({ d1: 7 })).toBe(false)
    expect(isLastSessionMap({ d1: '' })).toBe(false)
  })
})

describe('rememberSession', () => {
  test('records per desktop, so each machine keeps its own place', () => {
    const one = rememberSession({}, 'd1', 'p1:t1')
    const two = rememberSession(one, 'd2', 'p9:t9')
    expect(two).toEqual({ d1: 'p1:t1', d2: 'p9:t9' })
  })

  test('returns the same object when nothing changed, so no write fires', () => {
    const map = { d1: 'p1:t1' }
    expect(rememberSession(map, 'd1', 'p1:t1')).toBe(map)
  })

  test('does not mutate the previous map', () => {
    const map = { d1: 'p1:t1' }
    rememberSession(map, 'd1', 'p1:t2')
    expect(map.d1).toBe('p1:t1')
  })
})

describe('forgetDevice', () => {
  test('drops only the unpaired desktop', () => {
    expect(forgetDevice({ d1: 'a', d2: 'b' }, 'd1')).toEqual({ d2: 'b' })
  })

  test('returns the same object for an unknown desktop', () => {
    const map = { d1: 'a' }
    expect(forgetDevice(map, 'nope')).toBe(map)
  })
})
