import { useRouter } from 'expo-router'
import { Animated, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ActiveTabBar } from './ActiveTabBar'
import { ExtraKeysBar } from './ExtraKeysBar'
import { useKeyboardBar } from './keyboard-bar.hooks'
import TerminalDom from './TerminalDom'
import { useTabData } from './tab.data'

// The host scroller stays off. wterm's scrollback is a real overflow
// container inside the WebView, so the gesture belongs to it; leaving the
// RN scroller on makes the two compete for the same drag. xterm needed the
// opposite, because its viewport only moved when the hosting surface was
// itself scrollable.
const DOM_PROPS = { scrollEnabled: false, hideKeyboardAccessoryView: true }

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
  const { spacerHeight, barReveal, measureBar } = useKeyboardBar(
    insets.bottom,
    terminalRef,
  )

  // The sheet marks the session you are already in, so a glance does not
  // make you work out where you are before deciding where to go.
  const openSwitcher = () =>
    router.push({ pathname: '/switcher', params: { current: tabId } })

  // GestureHandlerRootView wraps THIS screen rather than the app, per the
  // repo's standing rule about keeping it out of _layout.tsx.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="bg-background flex-1">
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
