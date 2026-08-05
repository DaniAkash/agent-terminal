import { describe, expect, test } from 'bun:test'
import {
  classifyAppStateTransition,
  classifyNetInfoChange,
  decideForegroundAction,
  executeForegroundAction,
  executeNetInfoAction,
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

describe('executeForegroundAction', () => {
  type Rec = { id: string }
  const record: Rec = { id: 'r1' }

  function makeDeps(
    overrides: Partial<{
      autoConnect: (r: Rec) => Promise<void>
      probeConnection: () => Promise<'alive' | 'dead'>
      forceClose: (reason: string) => void
    }> = {},
  ) {
    const calls: string[] = []
    const deps = {
      autoConnect: async (r: Rec) => {
        calls.push(`autoConnect:${r.id}`)
      },
      probeConnection: async () => 'alive' as const,
      forceClose: (r: string) => {
        calls.push(`forceClose:${r}`)
      },
      ...overrides,
    }
    return { deps, calls }
  }

  test('action=skip is a no-op regardless of record', async () => {
    const { deps, calls } = makeDeps()
    await executeForegroundAction('skip', record, deps)
    await executeForegroundAction('skip', null, deps)
    expect(calls).toEqual([])
  })

  test('action=reconnect with a record calls autoConnect once', async () => {
    const { deps, calls } = makeDeps()
    await executeForegroundAction('reconnect', record, deps)
    expect(calls).toEqual(['autoConnect:r1'])
  })

  test('action=reconnect with null record does nothing (guard against races)', async () => {
    const { deps, calls } = makeDeps()
    await executeForegroundAction('reconnect', null, deps)
    expect(calls).toEqual([])
  })

  test('action=probe: alive verdict does NOT reconnect', async () => {
    let probes = 0
    const { deps, calls } = makeDeps({
      probeConnection: async () => {
        probes++
        return 'alive'
      },
    })
    await executeForegroundAction('probe', record, deps)
    expect(probes).toBe(1)
    expect(calls).toEqual([])
  })

  test('action=probe: dead verdict reconnects', async () => {
    const { deps, calls } = makeDeps({
      probeConnection: async () => 'dead',
    })
    await executeForegroundAction('probe', record, deps)
    expect(calls).toEqual(['autoConnect:r1'])
  })

  test('action=probe with null record: skip entirely (no probe either)', async () => {
    let probes = 0
    const { deps, calls } = makeDeps({
      probeConnection: async () => {
        probes++
        return 'dead'
      },
    })
    await executeForegroundAction('probe', null, deps)
    expect(probes).toBe(0)
    expect(calls).toEqual([])
  })
})

describe('executeNetInfoAction', () => {
  type Rec = { id: string }
  const record: Rec = { id: 'r1' }

  function makeDeps() {
    const calls: string[] = []
    const deps = {
      autoConnect: async (r: Rec) => {
        calls.push(`autoConnect:${r.id}`)
      },
      probeConnection: async () => 'alive' as const,
      forceClose: (reason: string) => {
        calls.push(`forceClose:${reason}`)
      },
    }
    return { deps, calls }
  }

  test('action=skip is a no-op', () => {
    const { deps, calls } = makeDeps()
    executeNetInfoAction('skip', record, deps)
    executeNetInfoAction('skip', null, deps)
    expect(calls).toEqual([])
  })

  test('action=force-close calls forceClose with the "network unreachable" reason', () => {
    const { deps, calls } = makeDeps()
    executeNetInfoAction('force-close', record, deps)
    expect(calls).toEqual(['forceClose:network unreachable'])
  })

  test('action=force-close ignores the record (works with or without one)', () => {
    const { deps, calls } = makeDeps()
    executeNetInfoAction('force-close', null, deps)
    expect(calls).toEqual(['forceClose:network unreachable'])
  })

  test('action=reconnect with a record kicks autoConnect', () => {
    const { deps, calls } = makeDeps()
    executeNetInfoAction('reconnect', record, deps)
    expect(calls).toEqual(['autoConnect:r1'])
  })

  test('action=reconnect with null record is a no-op (guard against races)', () => {
    const { deps, calls } = makeDeps()
    executeNetInfoAction('reconnect', null, deps)
    expect(calls).toEqual([])
  })
})
