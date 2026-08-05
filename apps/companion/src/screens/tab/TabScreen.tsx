import { useEffect, useRef } from 'react'
import { Animated, Keyboard, Platform, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ExtraKeysBar } from './ExtraKeysBar'
import TerminalDom from './TerminalDom'
import { useTabData } from './tab.data'

const DOM_PROPS = { scrollEnabled: false, hideKeyboardAccessoryView: true }

export function TabScreen({ tabId }: { tabId: string }) {
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
    status,
    deviceName,
  } = useTabData(tabId)
  const spacerHeight = useRef(new Animated.Value(0)).current
  const insets = useSafeAreaInsets()

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
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }).start()
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [spacerHeight, insets.bottom])

  return (
    <View className="flex-1 bg-background">
      <View className="border-border border-b bg-muted px-4 py-2">
        <Text className="text-muted-foreground text-xs">
          {deviceName ?? 'unknown'} · {status}
        </Text>
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
      />
      <Animated.View style={{ height: spacerHeight }} />
    </View>
  )
}
