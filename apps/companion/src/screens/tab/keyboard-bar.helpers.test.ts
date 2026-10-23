import { describe, expect, test } from 'bun:test'
import {
  FALLBACK_KEYBOARD_DURATION,
  keyboardDuration,
  keyboardEventNames,
  spacerForKeyboard,
} from './keyboard-bar.helpers'

describe('keyboardEventNames', () => {
  test('iOS animates from the events that fire before the keyboard moves', () => {
    expect(keyboardEventNames('ios')).toEqual({
      show: 'keyboardWillShow',
      hide: 'keyboardWillHide',
    })
  })

  // Android's Will pair fires alongside Did, with the keyboard already
  // in place, so animating from it would start a frame too late.
  test('Android animates from the events that actually report', () => {
    expect(keyboardEventNames('android')).toEqual({
      show: 'keyboardDidShow',
      hide: 'keyboardDidHide',
    })
  })
})

describe('keyboardDuration', () => {
  test('follows the keyboard when it reports one', () => {
    expect(keyboardDuration({ duration: 310 })).toBe(310)
  })

  // A hardware keyboard toggle reports zero, and timing to zero makes the
  // bar snap into place instead of arriving with the keyboard.
  test('falls back when the keyboard reports no animation', () => {
    expect(keyboardDuration({ duration: 0 })).toBe(FALLBACK_KEYBOARD_DURATION)
    expect(keyboardDuration({})).toBe(FALLBACK_KEYBOARD_DURATION)
  })
})

describe('spacerForKeyboard', () => {
  test('adds the navigation bar on Android, which the keyboard omits', () => {
    expect(spacerForKeyboard(300, 24, 'android')).toBe(324)
  })

  test('leaves iOS alone, where the home indicator is already counted', () => {
    expect(spacerForKeyboard(300, 34, 'ios')).toBe(300)
  })
})
