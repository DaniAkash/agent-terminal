import type {
  DesktopPushStatus,
  PushAssertion,
  PushPermission,
  PushPrefs,
} from './push.types'

export type RegistrationAction =
  | {
      kind: 'register'
      token: string
      delaySeconds: number
      redactNames: boolean
    }
  | { kind: 'unregister' }
  | { kind: 'none' }

export interface RegistrationInput {
  /** From `ServerFrame::PushStatus`. `null` until the desktop sends one. */
  desktop: DesktopPushStatus | null
  prefs: PushPrefs
  token: string | null
  /** What this phone has already told THIS desktop on THIS connection.
   *  Cleared whenever the socket turns over, which is what keeps the
   *  re-assert-on-every-connect recovery path. */
  asserted: PushAssertion | null
}

/**
 * What this device should tell the desktop about push, if anything.
 *
 * The first rule is the load-bearing one. The desktop closes the whole
 * WebSocket when it cannot deserialise a `ClientFrame`, so sending
 * `RegisterPush` to a Mac app older than this feature does not merely
 * fail to register: it disconnects terminal streaming, on every
 * connect, forever. `desktop` is non-null only once that Mac has
 * advertised push support, so this returns `none` until it has.
 *
 * The second rule is what makes it terminate. The desktop answers
 * `RegisterPush` with `OpOk` plus a fresh `PushStatus`, which lands back
 * in the store the registration subscription watches, so a decision
 * taken on wanting-push alone re-registers on its own echo, forever, at
 * one Keychain write each. `asserted` is this phone's record of what it
 * last sent, and comparing it to what the phone now wants is what tells
 * an echo apart from a token that rotated or a preference that moved.
 *
 * Token presence is still the enabled flag: a device either has a token
 * it wants used, or it does not and anything stored should be cleared.
 */
export function registrationAction(
  input: RegistrationInput,
): RegistrationAction {
  const desktop = input.desktop
  if (!desktop?.supported) return { kind: 'none' }

  if (input.prefs.enabled && input.token) {
    const want = {
      kind: 'register' as const,
      token: input.token,
      delaySeconds: input.prefs.delaySeconds,
      redactNames: input.prefs.redactNames,
    }
    return alreadyAsserted(input.asserted, want) ? { kind: 'none' } : want
  }

  // Nothing to clear is not the same as needing to clear nothing: an
  // unregister against a desktop that already has no token, or one
  // already told to clear on this connection, is a pointless round trip.
  if (input.asserted?.kind === 'cleared') return { kind: 'none' }
  return desktop.registered ? { kind: 'unregister' } : { kind: 'none' }
}

/**
 * Whether the desktop has already been told exactly this.
 *
 * A desktop reporting `registered: false` while holding a matching
 * assertion is not a mismatch to correct from here: it either rejected
 * the registration, in which case the send path clears the assertion and
 * the next trigger retries, or the connection turned over, which clears
 * it too.
 */
function alreadyAsserted(
  asserted: PushAssertion | null,
  want: { token: string; delaySeconds: number; redactNames: boolean },
): boolean {
  return (
    asserted?.kind === 'registered' &&
    asserted.token === want.token &&
    asserted.delaySeconds === want.delaySeconds &&
    asserted.redactNames === want.redactNames
  )
}

/**
 * Whether boot should fetch an Expo token before the registration gate
 * can read anything into it.
 *
 * The token lives in process memory only, so a cold start leaves an
 * enabled preference with no token beside it, and the gate reads that
 * pair as an opt-out and clears the desktop's registration. Fetching
 * one first is what stops startup hydration from disabling push.
 *
 * Granted permission only. Asking at boot is what the permission
 * sequencing exists to avoid, and `getExpoPushTokenAsync` on a device
 * that has not granted it cannot succeed anyway.
 */
export function shouldHydrateToken(input: {
  enabled: boolean
  permission: PushPermission
  token: string | null
}): boolean {
  return input.enabled && input.permission === 'granted' && !input.token
}
