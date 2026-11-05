import type { DesktopPushStatus, PushPrefs } from './push.types'

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
 * Token presence is the enabled flag, which is why there is no third
 * state here: a device either has a token it wants used, or it does
 * not and anything stored should be cleared.
 */
export function registrationAction(
  input: RegistrationInput,
): RegistrationAction {
  if (!input.desktop?.supported) return { kind: 'none' }

  if (input.prefs.enabled && input.token) {
    return {
      kind: 'register',
      token: input.token,
      delaySeconds: input.prefs.delaySeconds,
      redactNames: input.prefs.redactNames,
    }
  }

  // Nothing to clear is not the same as needing to clear nothing: an
  // unregister against a desktop that already has no token is a
  // pointless round trip on every connect.
  return input.desktop.registered ? { kind: 'unregister' } : { kind: 'none' }
}
