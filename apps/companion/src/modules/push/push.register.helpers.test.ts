import { describe, expect, test } from 'bun:test'
import {
  registrationAction,
  type RegistrationInput,
  shouldHydrateToken,
} from './push.register.helpers'
import type { DesktopPushStatus, PushAssertion, PushPrefs } from './push.types'

const desktop: DesktopPushStatus = {
  supported: true,
  registered: false,
  delaySeconds: 180,
  redactNames: false,
  lastError: null,
}

const on: PushPrefs = { enabled: true, delaySeconds: 180, redactNames: false }
const off: PushPrefs = { ...on, enabled: false }

/** Nothing said on this connection yet, which is every first sync. */
const fresh: Pick<RegistrationInput, 'asserted'> = { asserted: null }

/** What the phone sent for `on` plus token `tok`. */
const asserted: PushAssertion = {
  kind: 'registered',
  token: 'tok',
  delaySeconds: 180,
  redactNames: false,
}

describe('registrationAction', () => {
  test('registers once the desktop has advertised support', () => {
    expect(
      registrationAction({ ...fresh, desktop, prefs: on, token: 'tok' }),
    ).toEqual({
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
      registrationAction({ ...fresh, desktop: null, prefs: on, token: 'tok' }),
    ).toEqual({ kind: 'none' })
  })

  test('sends nothing when the desktop says push is unsupported', () => {
    expect(
      registrationAction({
        ...fresh,
        desktop: { ...desktop, supported: false },
        prefs: on,
        token: 'tok',
      }),
    ).toEqual({ kind: 'none' })
  })

  test('unregisters when the user switched it off and a token is stored', () => {
    expect(
      registrationAction({
        ...fresh,
        desktop: { ...desktop, registered: true },
        prefs: off,
        token: 'tok',
      }),
    ).toEqual({ kind: 'unregister' })
  })

  test('does not unregister what is not registered', () => {
    expect(
      registrationAction({ ...fresh, desktop, prefs: off, token: 'tok' }),
    ).toEqual({ kind: 'none' })
  })

  // Permission revoked in system settings, or the token fetch failed.
  // Wanting push is not the same as being able to receive it.
  test('unregisters when the token is gone even though the switch is on', () => {
    expect(
      registrationAction({
        ...fresh,
        desktop: { ...desktop, registered: true },
        prefs: on,
        token: null,
      }),
    ).toEqual({ kind: 'unregister' })
  })

  test('carries the current preferences, not the desktop stored ones', () => {
    const action = registrationAction({
      ...fresh,
      desktop: { ...desktop, delaySeconds: 30, redactNames: false },
      prefs: { enabled: true, delaySeconds: 600, redactNames: true },
      token: 'tok',
    })
    expect(action).toMatchObject({ delaySeconds: 600, redactNames: true })
  })
})

/**
 * The loop this gate closes: the desktop answers RegisterPush with OpOk
 * plus a fresh PushStatus, that status lands in the same store the
 * registration subscription watches, and a decision taken on wanting-
 * push alone registers again on its own echo, forever, at one Keychain
 * write each.
 */
describe('registrationAction, on the desktop echo', () => {
  test('does not re-register on an identical echo', () => {
    expect(
      registrationAction({
        desktop: { ...desktop, registered: true },
        prefs: on,
        token: 'tok',
        asserted,
      }),
    ).toEqual({ kind: 'none' })
  })

  test('re-registers when the Expo token rotated', () => {
    expect(
      registrationAction({
        desktop: { ...desktop, registered: true },
        prefs: on,
        token: 'rotated',
        asserted,
      }),
    ).toEqual({
      kind: 'register',
      token: 'rotated',
      delaySeconds: 180,
      redactNames: false,
    })
  })

  test('re-registers when the wait changed', () => {
    expect(
      registrationAction({
        desktop: { ...desktop, registered: true },
        prefs: { ...on, delaySeconds: 600 },
        token: 'tok',
        asserted,
      }),
    ).toEqual({
      kind: 'register',
      token: 'tok',
      delaySeconds: 600,
      redactNames: false,
    })
  })

  test('re-registers when redaction changed', () => {
    expect(
      registrationAction({
        desktop: { ...desktop, registered: true },
        prefs: { ...on, redactNames: true },
        token: 'tok',
        asserted,
      }),
    ).toMatchObject({ kind: 'register', redactNames: true })
  })

  // Same reason in the other direction: UnregisterPush is answered with
  // a status too, and the desktop may not have cleared its record.
  test('does not re-send an unregister it already sent', () => {
    expect(
      registrationAction({
        desktop: { ...desktop, registered: true },
        prefs: off,
        token: 'tok',
        asserted: { kind: 'cleared' },
      }),
    ).toEqual({ kind: 'none' })
  })

  test('registers again after an unregister when the user switches back on', () => {
    expect(
      registrationAction({
        desktop,
        prefs: on,
        token: 'tok',
        asserted: { kind: 'cleared' },
      }),
    ).toMatchObject({ kind: 'register', token: 'tok' })
  })

  // Clearing the assertion is what the socket teardown does, so this is
  // the re-assert-on-every-connect recovery path.
  test('re-asserts on a fresh connection', () => {
    expect(
      registrationAction({
        desktop: { ...desktop, registered: true },
        prefs: on,
        token: 'tok',
        asserted: null,
      }),
    ).toMatchObject({ kind: 'register', token: 'tok' })
  })
})

/**
 * The restart hole: the token is process memory only, so an enabled
 * preference comes back from storage with no token beside it, and the
 * gate above reads that pair as an opt-out.
 */
describe('shouldHydrateToken', () => {
  test('fetches for an enabled preference that has already been granted', () => {
    expect(
      shouldHydrateToken({
        enabled: true,
        permission: 'granted',
        token: null,
      }),
    ).toBe(true)
  })

  test('does not fetch when push is switched off', () => {
    expect(
      shouldHydrateToken({
        enabled: false,
        permission: 'granted',
        token: null,
      }),
    ).toBe(false)
  })

  // Asking at boot is the thing the permission sequencing exists to
  // avoid: the user cannot tell why the app wants notifications before
  // they have paired anything, so they deny, and iOS never asks again.
  test('does not fetch before permission has been granted', () => {
    expect(
      shouldHydrateToken({
        enabled: true,
        permission: 'undetermined',
        token: null,
      }),
    ).toBe(false)
    expect(
      shouldHydrateToken({ enabled: true, permission: 'denied', token: null }),
    ).toBe(false)
  })

  test('does not fetch a token it already has', () => {
    expect(
      shouldHydrateToken({
        enabled: true,
        permission: 'granted',
        token: 'tok',
      }),
    ).toBe(false)
  })
})
