import { describe, expect, test } from 'bun:test'
import {
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

  // Android always reports zero, because its event fires once the
  // keyboard has already moved. Reporting that honestly is what lets the
  // caller place the bar instead of animating towards a finished move.
  test('reports zero when there is no travel left to match', () => {
    expect(keyboardDuration({ duration: 0 })).toBe(0)
    expect(keyboardDuration({})).toBe(0)
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
