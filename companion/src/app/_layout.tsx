import '../../global.css'
import { ActionSheetProvider } from '@expo/react-native-action-sheet'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { $device, loadDeviceFromSecureStore } from '@/modules/stores/$device'
import { $session } from '@/modules/stores/$session'
import { autoConnect } from '@/modules/wss/client'

// ActionSheetProvider wraps any component that uses useActionSheet()
// from @expo/react-native-action-sheet (Phase B long-press menus on
// Projects screen). Pure JS; safe here at the root.
//
// GestureHandlerRootView is NOT wrapped here per the Expo tutorial's
// pattern (https://docs.expo.dev/tutorial/gestures/). It goes inside
// the specific screen that uses gestures, so gesture-handler's
// native-module setup runs after expo-router has bootstrapped rather
// than during the first import of _layout.tsx.
export default function RootLayout() {
  // Cold-start boot: read the persisted DeviceRecord and, if present,
  // kick the self-healing resolver ladder in the background. Session
  // status flips through `connecting` → `connected`/`unreachable`;
  // the UI reads $session and gates on it. useEffect exception: this
  // is a boot-time side effect syncing an external store (secure
  // storage) into the running app, one of CLAUDE.md's explicit
  // "legitimate useEffect" cases.
  useEffect(() => {
    void (async () => {
      await loadDeviceFromSecureStore()
      const rec = $device.get().record
      if (rec && $session.get().status === 'disconnected') {
        void autoConnect(rec)
      }
    })()
  }, [])
  return (
    // biome-ignore lint/complexity/noUselessFragments: ActionSheetProvider
    // uses React.Children.only internally, so the sibling StatusBar +
    // Stack must be wrapped as a single fragment child.
    <ActionSheetProvider>
      <>
        <StatusBar style="auto" />
        <Stack>
          <Stack.Screen name="index" options={{ title: 'Agent Terminal' }} />
          <Stack.Screen name="pair" options={{ title: 'Pair with desktop' }} />
          <Stack.Screen name="connect" options={{ title: 'Manual connect' }} />
          <Stack.Screen
            name="projects"
            options={{
              title: 'Projects',
              presentation: 'modal',
            }}
          />
          <Stack.Screen
            name="tab/[tabid]"
            options={{
              headerBackTitle: 'Back',
            }}
          />
        </Stack>
      </>
    </ActionSheetProvider>
  )
}
