import { useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Animated, Keyboard, Platform, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ActiveTabBar } from './ActiveTabBar'
import { ExtraKeysBar } from './ExtraKeysBar'
import TerminalDom from './TerminalDom'
import { useTabData } from './tab.data'

// The host scroller has to stay on. xterm keeps its scrollback in its own
// `.xterm-viewport`, and that element only scrolls under a finger when the
// surface hosting it is scrollable: with this off, 2000 lines of history
// exist and none of them can be reached on a touch device.
const DOM_PROPS = { scrollEnabled: true, hideKeyboardAccessoryView: true }

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

  useEffect(() => {
    // Animated.Value updates the native view's height directly, no React
    // re-render. Prevents the WebView from being torn down / losing focus
    // when the keyboard shows.
    //
    // Android: `endCoordinates.height` from RN's Keyboard event often
    // reports the keyboard portion WITHOUT the OS navigation bar area at
    // the bottom of the display. Add insets.bottom on Android to cover
    // the gesture / three-button strip, so the ExtraKeysBar rides above
    // the keyboard AND clears the nav bar. iOS's keyboard height already
    // accounts for the home indicator, so this correction is a no-op
    // there (insets.bottom is folded into endCoordinates.height on iOS).
    const androidBottomPad = Platform.OS === 'android' ? insets.bottom : 0
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      Animated.timing(spacerHeight, {
        toValue: e.endCoordinates.height + androidBottomPad,
        duration: 250,
        useNativeDriver: false,
      }).start()
    })
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      Animated.timing(spacerHeight, {
        toValue: insets.bottom,
        duration: 250,
        useNativeDriver: false,
      }).start()
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [spacerHeight, insets.bottom])

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
            glyph={active.glyph}
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
            dom={DOM_PROPS}
          />
        </View>
        <ExtraKeysBar
          ctrlArmed={ctrlArmed}
          altArmed={altArmed}
          onKey={onKey}
          onToggleCtrl={toggleCtrl}
          onToggleAlt={toggleAlt}
          onMore={openSwitcher}
        />
        <Animated.View style={{ height: spacerHeight }} />
      </View>
    </GestureHandlerRootView>
  )
}
