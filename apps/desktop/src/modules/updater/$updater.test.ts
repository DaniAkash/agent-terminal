import { mock } from 'bun:test'

// Mock the @tauri-apps modules before importing checkForUpdate — the
// real plugins invoke Tauri commands that don't exist in the test
// runtime. We control what `check()` resolves to per test.
const mockCheck = mock<
  () => Promise<{ version: string; body: string | null } | null>
>(() => Promise.resolve(null))

mock.module('@tauri-apps/plugin-updater', () => ({
  check: mockCheck,
}))

mock.module('@tauri-apps/api/app', () => ({
  getVersion: mock(() => Promise.resolve('0.1.3')),
}))

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  $hasCheckedThisSession,
  $updater,
  type UpdaterState,
} from '@/modules/updater/$updater'
import { checkForUpdate } from '@/modules/updater/checkForUpdate'

beforeEach(() => {
  $updater.set({ kind: 'idle' })
  $hasCheckedThisSession.set(false)
  mockCheck.mockReset()
})

/* ---------------------------------------------------------------------------
 * $updater store — discriminated-union state shape
 * -------------------------------------------------------------------------*/
describe('$updater store', () => {
  test('1: starts in idle', () => {
    expect($updater.get()).toEqual({ kind: 'idle' })
  })

  test('2: accepts every kind in the discriminated union', () => {
    const cases: UpdaterState[] = [
      { kind: 'idle' },
      { kind: 'checking' },
      { kind: 'available', version: '1.0.0', notes: 'notes' },
      { kind: 'downloading', progress: 0.5 },
      { kind: 'ready-to-install' },
      { kind: 'error', message: 'boom' },
      { kind: 'up-to-date', currentVersion: '0.1.3' },
    ]
    for (const s of cases) {
      $updater.set(s)
      expect($updater.get()).toEqual(s)
    }
  })
})

/* ---------------------------------------------------------------------------
 * $hasCheckedThisSession — sticky one-shot flag
 * -------------------------------------------------------------------------*/
describe('$hasCheckedThisSession', () => {
  test('3: starts false', () => {
    expect($hasCheckedThisSession.get()).toBe(false)
  })

  test('4: set(true) sticks across reads', () => {
    $hasCheckedThisSession.set(true)
    expect($hasCheckedThisSession.get()).toBe(true)
    expect($hasCheckedThisSession.get()).toBe(true)
  })
})

/* ---------------------------------------------------------------------------
 * checkForUpdate() — composes check() with the store
 * -------------------------------------------------------------------------*/
describe('checkForUpdate()', () => {
  test('5: moves through checking → up-to-date when no update is returned', async () => {
    mockCheck.mockResolvedValue(null)
    const states: UpdaterState[] = []
    const unsub = $updater.subscribe((s) => states.push(s))

    await checkForUpdate()
    unsub()

    // First state is the initial idle pushed at subscribe time.
    expect(states[0]).toEqual({ kind: 'idle' })
    expect(states.some((s) => s.kind === 'checking')).toBe(true)
    expect($updater.get()).toEqual({
      kind: 'up-to-date',
      currentVersion: '0.1.3',
    })
  })

  test('6: moves to available with version + notes when check resolves', async () => {
    mockCheck.mockResolvedValue({
      version: '0.2.0',
      body: 'New stuff.',
    })

    await checkForUpdate()

    expect($updater.get()).toEqual({
      kind: 'available',
      version: '0.2.0',
      notes: 'New stuff.',
    })
  })

  test('7: tolerates a missing notes body (null → empty string)', async () => {
    mockCheck.mockResolvedValue({ version: '0.2.0', body: null })

    await checkForUpdate()

    expect($updater.get()).toEqual({
      kind: 'available',
      version: '0.2.0',
      notes: '',
    })
  })

  test('8: silentOnFailure=true falls back to idle on check() rejection', async () => {
    mockCheck.mockRejectedValue(new Error('offline'))

    await checkForUpdate({ silentOnFailure: true })

    expect($updater.get()).toEqual({ kind: 'idle' })
  })

  test('9: silentOnFailure=false surfaces the error in the store', async () => {
    mockCheck.mockRejectedValue(new Error('endpoint 500'))

    await checkForUpdate({ silentOnFailure: false })

    expect($updater.get()).toEqual({
      kind: 'error',
      message: 'endpoint 500',
    })
  })

  test('10: a non-Error rejection is coerced to a string', async () => {
    mockCheck.mockRejectedValue('thrown a string for some reason')

    await checkForUpdate()

    expect($updater.get()).toEqual({
      kind: 'error',
      message: 'thrown a string for some reason',
    })
  })

  test('11: default options surface errors (silentOnFailure defaults to false)', async () => {
    mockCheck.mockRejectedValue(new Error('boom'))

    await checkForUpdate()

    expect($updater.get()).toEqual({ kind: 'error', message: 'boom' })
  })

  test('12: silentOnUpToDate=true keeps store idle when no update is available', async () => {
    mockCheck.mockResolvedValue(null)

    await checkForUpdate({ silentOnUpToDate: true })

    expect($updater.get()).toEqual({ kind: 'idle' })
  })

  test('13: silentOnUpToDate=false still surfaces up-to-date (default)', async () => {
    mockCheck.mockResolvedValue(null)

    await checkForUpdate({ silentOnUpToDate: false })

    expect($updater.get()).toEqual({
      kind: 'up-to-date',
      currentVersion: '0.1.3',
    })
  })
})
