import { describe, expect, test } from 'bun:test'
import { registrationAction } from './push.register.helpers'
import type { DesktopPushStatus, PushPrefs } from './push.types'

const desktop: DesktopPushStatus = {
  supported: true,
  registered: false,
  delaySeconds: 180,
  redactNames: false,
  lastError: null,
}

const on: PushPrefs = { enabled: true, delaySeconds: 180, redactNames: false }
const off: PushPrefs = { ...on, enabled: false }

describe('registrationAction', () => {
  test('registers once the desktop has advertised support', () => {
    expect(registrationAction({ desktop, prefs: on, token: 'tok' })).toEqual({
      kind: 'register',
      token: 'tok',
      delaySeconds: 180,
      redactNames: false,
    })
  })

  // The rule that stops a newer phone disconnecting an older Mac on
  // every connect. A desktop that never sent PushStatus cannot parse
  // RegisterPush and closes the session on the attempt.
  test('sends nothing to a desktop that never advertised push', () => {
    expect(
      registrationAction({ desktop: null, prefs: on, token: 'tok' }),
    ).toEqual({ kind: 'none' })
  })

  test('sends nothing when the desktop says push is unsupported', () => {
    expect(
      registrationAction({
        desktop: { ...desktop, supported: false },
        prefs: on,
        token: 'tok',
      }),
    ).toEqual({ kind: 'none' })
  })

  test('unregisters when the user switched it off and a token is stored', () => {
    expect(
      registrationAction({
        desktop: { ...desktop, registered: true },
        prefs: off,
        token: 'tok',
      }),
    ).toEqual({ kind: 'unregister' })
  })

  test('does not unregister what is not registered', () => {
    expect(registrationAction({ desktop, prefs: off, token: 'tok' })).toEqual({
      kind: 'none',
    })
  })

  // Permission revoked in system settings, or the token fetch failed.
  // Wanting push is not the same as being able to receive it.
  test('unregisters when the token is gone even though the switch is on', () => {
    expect(
      registrationAction({
        desktop: { ...desktop, registered: true },
        prefs: on,
        token: null,
      }),
    ).toEqual({ kind: 'unregister' })
  })

  test('carries the current preferences, not the desktop stored ones', () => {
    const action = registrationAction({
      desktop: { ...desktop, delaySeconds: 30, redactNames: false },
      prefs: { enabled: true, delaySeconds: 600, redactNames: true },
      token: 'tok',
    })
    expect(action).toMatchObject({ delaySeconds: 600, redactNames: true })
  })
})
