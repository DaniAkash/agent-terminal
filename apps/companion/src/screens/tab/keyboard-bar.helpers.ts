import type { KeyboardEventName } from 'react-native'

/**
 * How long to animate when the keyboard event carries no usable
 * duration. iOS normally reports around 250ms, so an event that omits it
 * still lands in the same neighbourhood.
 */
export const FALLBACK_KEYBOARD_DURATION = 250

/**
 * Which pair of keyboard events to drive the bar from.
 *
 * iOS fires the `Will` pair as the keyboard starts moving and carries the
 * system's own duration, so animating from those tracks the keyboard
 * rather than chasing it. Android has no usable `Will` pair: it fires at
 * the same moment as `Did`, with the keyboard already in place, so there
 * the `Did` pair is both what exists and what is accurate.
 */
export function keyboardEventNames(os: string): {
  show: KeyboardEventName
  hide: KeyboardEventName
} {
  return os === 'ios'
    ? { show: 'keyboardWillShow', hide: 'keyboardWillHide' }
    : { show: 'keyboardDidShow', hide: 'keyboardDidHide' }
}

/**
 * The duration to animate for, taken from the keyboard itself.
 *
 * iOS sends 0 when the keyboard changes without animating, which a
 * hardware keyboard toggle produces. Timing to 0 makes the bar snap, so
 * anything non-positive falls back rather than being passed through.
 */
export function keyboardDuration(event: { duration?: number }): number {
  const reported = event.duration
  return reported !== undefined && reported > 0
    ? reported
    : FALLBACK_KEYBOARD_DURATION
}

/**
 * How tall the spacer under the key bar should be.
 *
 * Android's `endCoordinates.height` often excludes the navigation bar at
 * the bottom of the display, so the inset is added there to clear the
 * gesture or three button strip. iOS already folds the home indicator
 * into the keyboard height, which is why the correction is platform
 * specific rather than unconditional.
 */
export function spacerForKeyboard(
  keyboardHeight: number,
  bottomInset: number,
  os: string,
): number {
  return keyboardHeight + (os === 'android' ? bottomInset : 0)
}
