import { type RefObject, useEffect, useRef } from 'react'
import { Animated, Easing, Keyboard, Platform } from 'react-native'
import {
  keyboardDuration,
  keyboardEventNames,
  spacerForKeyboard,
} from './keyboard-bar.helpers'

// Approximates the curve UIKit moves the keyboard along. The exact one is
// private, and the default ease makes the bar visibly lag the keyboard it
// is supposed to be riding on.
const KEYBOARD_EASING = Easing.bezier(0.17, 0.59, 0.25, 1)

/** The one thing the bar asks of the terminal: give its focus back. */
interface BlurTarget {
  blurInput: () => void
}

interface KeyboardBar {
  /** Height of the spacer under the bar; follows the keyboard. */
  spacerHeight: Animated.Value
  /** How much of the key bar is showing, in points. */
  barReveal: Animated.Value
  /** Report the bar's measured height from its `onLayout`. */
  measureBar: (height: number) => void
}

/**
 * Keep the extra-keys bar and the spacer under it riding on the
 * keyboard: the bar slides out as the keyboard rises and leaves with it.
 */
export function useKeyboardBar(
  bottomInset: number,
  terminalRef: RefObject<BlurTarget | null>,
): KeyboardBar {
  // Rests at the bottom inset rather than zero so the last key row clears
  // the home indicator. Sitting in that strip, iOS swallows the touch
  // before it reaches the key: the wider keys still have tappable area
  // above it, but a half-width one is simply dead.
  const spacerHeightRef = useRef<Animated.Value | null>(null)
  spacerHeightRef.current ??= new Animated.Value(bottomInset)
  const spacerHeight = spacerHeightRef.current
  // How much of the key bar is showing. The bar only earns its space
  // while there is a keyboard to sit on: with the keyboard down there is
  // nothing to type into, and the two rows were taking scrollback from
  // the terminal to say so.
  const barRevealRef = useRef<Animated.Value | null>(null)
  barRevealRef.current ??= new Animated.Value(0)
  const barReveal = barRevealRef.current
  // Measured rather than declared, so a change to the bar's padding or
  // type size cannot leave it clipped. Zero until the first layout, which
  // happens long before a keyboard can be raised.
  const barHeight = useRef(0)

  useEffect(() => {
    // Animated.Value updates the native view's height directly, no React
    // re-render. Prevents the WebView from being torn down / losing focus
    // when the keyboard shows.
    const { show, hide } = keyboardEventNames(Platform.OS)
    const onShow = Keyboard.addListener(show, (e) => {
      animateBottom(
        spacerHeight,
        spacerForKeyboard(e.endCoordinates.height, bottomInset, Platform.OS),
        barReveal,
        barHeight.current,
        keyboardDuration(e),
      )
    })
    const onHide = Keyboard.addListener(hide, (e) => {
      // Hand the terminal's focus back when the keyboard goes, so the next
      // tap on it is a focus change and raises the keyboard again. Held
      // focus is why the keyboard used to be unreachable after its own
      // dismiss button, and with the key bar now leaving alongside it,
      // that would strand the session with no way to type into it.
      terminalRef.current?.blurInput()
      animateBottom(
        spacerHeight,
        bottomInset,
        barReveal,
        0,
        keyboardDuration(e),
      )
    })
    return () => {
      onShow.remove()
      onHide.remove()
    }
  }, [spacerHeight, barReveal, bottomInset, terminalRef])

  function measureBar(height: number): void {
    barHeight.current = height
    // The bar can first lay out with the keyboard already up, which the
    // show listener has by then already missed. Without this the bar
    // would stay collapsed until the keyboard was dismissed and raised.
    if (Keyboard.isVisible()) barReveal.setValue(height)
  }

  return { spacerHeight, barReveal, measureBar }
}

/**
 * Move the spacer and the key bar together, on the keyboard's own clock.
 *
 * A zero duration means the keyboard has already finished moving, which
 * is every Android event and an iOS hardware keyboard toggle. Placing
 * the values is then both correct and the only reliable option: Android
 * emits several events per appearance, and a timing started on each one
 * competes with the one still running, which left the bar stopping
 * somewhere short of its mark and at a different place each time.
 *
 * Otherwise one `parallel` rather than two `start()` calls, so the bar
 * cannot drift a frame away from the keyboard it is sitting on.
 */
function animateBottom(
  spacer: Animated.Value,
  spacerTo: number,
  reveal: Animated.Value,
  revealTo: number,
  duration: number,
): void {
  if (duration <= 0) {
    spacer.setValue(spacerTo)
    reveal.setValue(revealTo)
    return
  }
  Animated.parallel([
    Animated.timing(spacer, {
      toValue: spacerTo,
      duration,
      easing: KEYBOARD_EASING,
      useNativeDriver: false,
    }),
    Animated.timing(reveal, {
      toValue: revealTo,
      duration,
      easing: KEYBOARD_EASING,
      useNativeDriver: false,
    }),
  ]).start()
}
