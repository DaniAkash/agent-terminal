import { describe, expect, test } from 'bun:test'
import {
  classifyAppStateTransition,
  classifyNetInfoChange,
  decideForegroundAction,
  TRUSTED_BACKGROUND_MS,
} from './lifecycle.helpers'

describe('classifyAppStateTransition', () => {
  test('active -> background is a background transition', () => {
    expect(classifyAppStateTransition('active', 'background')).toBe(
      'background',
    )
  })

  test('active -> inactive counts as background too (iOS quick-swipe path)', () => {
    expect(classifyAppStateTransition('active', 'inactive')).toBe('background')
  })

  test('background -> active is a foreground transition', () => {
    expect(classifyAppStateTransition('background', 'active')).toBe(
      'foreground',
    )
  })

  test('inactive -> active is a foreground transition', () => {
    expect(classifyAppStateTransition('inactive', 'active')).toBe('foreground')
  })

  test('active -> active is a no-op', () => {
    expect(classifyAppStateTransition('active', 'active')).toBe('none')
  })

  test('background -> inactive is a no-op (neither edge we care about)', () => {
    expect(classifyAppStateTransition('background', 'inactive')).toBe('none')
  })

  test('inactive -> background is a no-op', () => {
    expect(classifyAppStateTransition('inactive', 'background')).toBe('none')
  })
})

describe('decideForegroundAction', () => {
  test('no paired device: skip', () => {
    expect(decideForegroundAction(0, 'connected', false)).toBe('skip')
    expect(decideForegroundAction(9_999_999, 'unreachable', false)).toBe('skip')
  })

  test('already connecting: skip so we do not double the ladder', () => {
    expect(decideForegroundAction(0, 'connecting', true)).toBe('skip')
    expect(decideForegroundAction(90_000, 'connecting', true)).toBe('skip')
  })

  test('short background AND currently connected: probe', () => {
    expect(decideForegroundAction(10_000, 'connected', true)).toBe('probe')
    expect(
      decideForegroundAction(TRUSTED_BACKGROUND_MS, 'connected', true),
    ).toBe('probe')
  })

  test('long background (> TRUSTED_BACKGROUND_MS): reconnect', () => {
    expect(
      decideForegroundAction(TRUSTED_BACKGROUND_MS + 1, 'connected', true),
    ).toBe('reconnect')
    expect(decideForegroundAction(300_000, 'connected', true)).toBe('reconnect')
  })

  test('was offline (unreachable / disconnected / auth_failed) with a record: reconnect', () => {
    expect(decideForegroundAction(0, 'unreachable', true)).toBe('reconnect')
    expect(decideForegroundAction(0, 'disconnected', true)).toBe('reconnect')
    expect(decideForegroundAction(0, 'auth_failed', true)).toBe('reconnect')
  })
})

describe('classifyNetInfoChange', () => {
  test('network went unreachable while we thought we were connected: force-close', () => {
    expect(
      classifyNetInfoChange({ isInternetReachable: false }, 'connected', true),
    ).toBe('force-close')
  })

  test('network back while unreachable AND paired: reconnect', () => {
    expect(
      classifyNetInfoChange({ isInternetReachable: true }, 'unreachable', true),
    ).toBe('reconnect')
  })

  test('network back but no paired device: skip', () => {
    expect(
      classifyNetInfoChange(
        { isInternetReachable: true },
        'unreachable',
        false,
      ),
    ).toBe('skip')
  })

  test('network back but we think we are still connected: skip (heartbeat will notice if not)', () => {
    expect(
      classifyNetInfoChange({ isInternetReachable: true }, 'connected', true),
    ).toBe('skip')
  })

  test('unreachability while already unreachable: skip (already knew)', () => {
    expect(
      classifyNetInfoChange(
        { isInternetReachable: false },
        'unreachable',
        true,
      ),
    ).toBe('skip')
  })

  test('null isInternetReachable (unknown, common on Android boot): skip', () => {
    expect(
      classifyNetInfoChange({ isInternetReachable: null }, 'connected', true),
    ).toBe('skip')
    expect(
      classifyNetInfoChange({ isInternetReachable: null }, 'unreachable', true),
    ).toBe('skip')
  })
})
