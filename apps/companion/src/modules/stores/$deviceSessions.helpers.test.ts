import { describe, expect, test } from 'bun:test'
import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import {
  cacheDeviceSessions,
  type DeviceSessionsMap,
  dropDeviceSessions,
  isDeviceSessionsMap,
} from './$deviceSessions.helpers'

const PROJECTS = [
  { project_id: 'p1', name: 'valet', is_expanded: true, tabs: [] },
] as unknown as ProjectSummary[]

describe('isDeviceSessionsMap', () => {
  test('accepts an empty map', () => {
    expect(isDeviceSessionsMap({})).toBe(true)
  })

  test('accepts a map of well-formed entries', () => {
    const map: DeviceSessionsMap = { d1: { projects: PROJECTS, syncedAt: 1 } }
    expect(isDeviceSessionsMap(map)).toBe(true)
  })

  test('rejects non-objects', () => {
    expect(isDeviceSessionsMap(null)).toBe(false)
    expect(isDeviceSessionsMap('x')).toBe(false)
    expect(isDeviceSessionsMap([])).toBe(false)
  })

  test('rejects an entry missing projects or syncedAt', () => {
    expect(isDeviceSessionsMap({ d1: { projects: PROJECTS } })).toBe(false)
    expect(isDeviceSessionsMap({ d1: { syncedAt: 1 } })).toBe(false)
    expect(isDeviceSessionsMap({ d1: { projects: 'nope', syncedAt: 1 } })).toBe(
      false,
    )
  })
})

describe('cacheDeviceSessions', () => {
  test('adds a new device entry', () => {
    const next = cacheDeviceSessions({}, 'd1', PROJECTS, 100)
    expect(next.d1).toEqual({ projects: PROJECTS, syncedAt: 100 })
  })

  test('overwrites only the named device, leaving others untouched', () => {
    const start: DeviceSessionsMap = {
      d1: { projects: PROJECTS, syncedAt: 1 },
      d2: { projects: [], syncedAt: 2 },
    }
    const next = cacheDeviceSessions(start, 'd1', PROJECTS, 200)
    expect(next.d1?.syncedAt).toBe(200)
    expect(next.d2).toEqual(start.d2)
  })
})

describe('dropDeviceSessions', () => {
  test('removes the named device', () => {
    const start: DeviceSessionsMap = { d1: { projects: PROJECTS, syncedAt: 1 } }
    expect(dropDeviceSessions(start, 'd1')).toEqual({})
  })

  test('is a no-op, and returns the same reference, for an unknown device', () => {
    const start: DeviceSessionsMap = { d1: { projects: PROJECTS, syncedAt: 1 } }
    expect(dropDeviceSessions(start, 'd2')).toBe(start)
  })
})
