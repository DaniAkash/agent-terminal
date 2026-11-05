import { describe, expect, test } from 'bun:test'
import type { DesktopPushStatus } from '@/modules/push/push.types'
import { formatDelay, nextDelay, statusView } from './notifications.helpers'

const desktop: DesktopPushStatus = {
  supported: true,
  registered: true,
  delaySeconds: 180,
  redactNames: false,
  lastError: null,
}

const working = {
  support: 'ok' as const,
  permission: 'granted' as const,
  connected: true,
  desktop,
  enabled: true,
}

describe('statusView', () => {
  test('reports on when every link in the chain holds', () => {
    expect(statusView(working)).toMatchObject({ kind: 'on', tone: 'ok' })
  })

  // Each of these would otherwise present as a switch that is on and
  // does nothing, which is the failure mode this line exists to stop.
  test('an emulator without Play services is unsupported, not broken', () => {
    expect(statusView({ ...working, support: 'unsupported' }).kind).toBe(
      'unsupported',
    )
  })

  test('a denied permission offers the only route forward', () => {
    const v = statusView({ ...working, permission: 'denied' })
    expect(v.kind).toBe('blocked')
    expect(v.action).toBe('open-system-settings')
  })

  test('no connection reports waiting rather than failure', () => {
    expect(statusView({ ...working, connected: false }).kind).toBe(
      'disconnected',
    )
  })

  test('a desktop that never advertised push says so', () => {
    const v = statusView({ ...working, desktop: null })
    expect(v.kind).toBe('desktop-too-old')
    expect(v.action).toBe('update-desktop')
  })

  test('a credentials failure on the desktop surfaces here', () => {
    const v = statusView({
      ...working,
      desktop: { ...desktop, lastError: 'push credentials rejected' },
    })
    expect(v.kind).toBe('desktop-error')
    expect(v.detail).toContain('credentials')
  })

  test('off when the user turned it off', () => {
    expect(statusView({ ...working, enabled: false }).kind).toBe('off')
  })

  test('registering is transient, not an error', () => {
    const v = statusView({
      ...working,
      desktop: { ...desktop, registered: false },
    })
    expect(v.kind).toBe('registering')
    expect(v.tone).not.toBe('bad')
  })

  // Order is the whole design: a blocked permission must win over a
  // desktop problem, or the user chases the wrong fix.
  test('permission outranks every desktop-side problem', () => {
    const v = statusView({
      ...working,
      permission: 'denied',
      desktop: null,
      connected: false,
    })
    expect(v.kind).toBe('blocked')
  })
})

describe('formatDelay', () => {
  test.each([
    [0, 'Right away'],
    [30, '30 seconds'],
    [60, '1 minute'],
    [180, '3 minutes'],
    [1800, '30 minutes'],
  ])('%i seconds reads as %s', (seconds, expected) => {
    expect(formatDelay(seconds)).toBe(expected)
  })
})

describe('nextDelay', () => {
  test('steps to the next offered wait', () => {
    expect(nextDelay(180)).toBe(300)
  })

  test('wraps at the end', () => {
    expect(nextDelay(1800)).toBe(0)
  })

  test('an unrecognised value falls back to the first choice', () => {
    expect(nextDelay(77)).toBe(0)
  })
})
