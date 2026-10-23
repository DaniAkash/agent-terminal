import type { KeyboardEventName } from 'react-native'

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
 * How long the bar has to move, taken from the keyboard itself.
 *
 * Zero is a real answer, not a missing one. Android reports it because
 * `keyboardDidShow` fires once the keyboard is already in place, and iOS
 * reports it when the keyboard changes without animating, as a hardware
 * keyboard toggle does. Either way there is no travel left to match, and
 * the caller should place the bar rather than animate it there: timing
 * towards a keyboard that has already arrived is what left the bar
 * sitting behind it, a frame or several short of its mark.
 */
export function keyboardDuration(event: { duration?: number }): number {
  const reported = event.duration
  return reported !== undefined && reported > 0 ? reported : 0
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
