import { useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Animated, Easing, Keyboard, Platform, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ActiveTabBar } from './ActiveTabBar'
import { ExtraKeysBar } from './ExtraKeysBar'
import {
  keyboardDuration,
  keyboardEventNames,
  spacerForKeyboard,
} from './keyboard-bar.helpers'
import TerminalDom from './TerminalDom'
import { useTabData } from './tab.data'

// The host scroller stays off. wterm's scrollback is a real overflow
// container inside the WebView, so the gesture belongs to it; leaving the
// RN scroller on makes the two compete for the same drag. xterm needed the
// opposite, because its viewport only moved when the hosting surface was
// itself scrollable.
const DOM_PROPS = { scrollEnabled: false, hideKeyboardAccessoryView: true }

// Approximates the curve UIKit moves the keyboard along. The exact one is
// private, and the default ease makes the bar visibly lag the keyboard it
// is supposed to be riding on.
const KEYBOARD_EASING = Easing.bezier(0.17, 0.59, 0.25, 1)

interface TabScreenProps {
  projectId: string
  /** Composed wire id, which is what every stream op addresses. */
  tabId: string
}

export function TabScreen({ projectId, tabId }: TabScreenProps) {
  const router = useRouter()
  const {
    terminalRef,
    onData,
    onResize,
    onReady,
    onOpenUrl,
    onKey,
    ctrlArmed,
    altArmed,
    toggleCtrl,
    toggleAlt,
    active,
    connected,
  } = useTabData(projectId, tabId)
  const insets = useSafeAreaInsets()
  // Rests at the bottom inset rather than zero so the last key row clears
  // the home indicator. Sitting in that strip, iOS swallows the touch
  // before it reaches the key: the wider keys still have tappable area
  // above it, but a half-width one is simply dead.
  const spacerHeight = useRef(new Animated.Value(insets.bottom)).current
  // How much of the key bar is showing. The bar only earns its space
  // while there is a keyboard to sit on: with the keyboard down there is
  // nothing to type into, and the two rows were taking scrollback from
  // the terminal to say so.
  const barReveal = useRef(new Animated.Value(0)).current
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
        spacerForKeyboard(e.endCoordinates.height, insets.bottom, Platform.OS),
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
        insets.bottom,
        barReveal,
        0,
        keyboardDuration(e),
      )
    })
    return () => {
      onShow.remove()
      onHide.remove()
    }
  }, [spacerHeight, barReveal, insets.bottom, terminalRef])

  function measureBar(height: number): void {
    barHeight.current = height
    // The bar can first lay out with the keyboard already up, which the
    // show listener has by then already missed. Without this the bar
    // would stay collapsed until the keyboard was dismissed and raised.
    if (Keyboard.isVisible()) barReveal.setValue(height)
  }

  // The sheet marks the session you are already in, so a glance does not
  // make you work out where you are before deciding where to go.
  const openSwitcher = () =>
    router.push({ pathname: '/switcher', params: { current: tabId } })

  // GestureHandlerRootView wraps THIS screen rather than the app, per the
  // repo's standing rule about keeping it out of _layout.tsx.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="flex-1 bg-background">
        {/* The navigation header used to hold this screen clear of the
            status bar. With the header gone the top inset moves here,
            painted in the bar's own colour so the strip above it reads as
            part of the bar rather than a second band. */}
        <View className="bg-muted" style={{ paddingTop: insets.top }}>
          <ActiveTabBar
            label={active.label}
            projectName={active.projectName}
            visual={active.visual}
            connected={connected}
            onPress={openSwitcher}
          />
        </View>
        <View className="flex-1">
          <TerminalDom
            ref={terminalRef}
            onData={onData}
            onResize={onResize}
            onReady={onReady}
            onOpenUrl={onOpenUrl}
            dom={DOM_PROPS}
          />
        </View>
        {/* The bar is absolutely positioned inside a clipping box whose
            height is animated, so it keeps its natural size and is
            revealed from the bottom up: it reads as sliding out from
            behind the keyboard rather than unfolding in place. In flow
            it would be squashed instead of clipped. */}
        <Animated.View style={{ height: barReveal, overflow: 'hidden' }}>
          <View
            onLayout={(e) => measureBar(e.nativeEvent.layout.height)}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
          >
            <ExtraKeysBar
              ctrlArmed={ctrlArmed}
              altArmed={altArmed}
              onKey={onKey}
              onToggleCtrl={toggleCtrl}
              onToggleAlt={toggleAlt}
              onMore={openSwitcher}
            />
          </View>
        </Animated.View>
        <Animated.View style={{ height: spacerHeight }} />
      </View>
    </GestureHandlerRootView>
  )
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
