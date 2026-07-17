import '../../global.css'
import { ActionSheetProvider } from '@expo/react-native-action-sheet'
import { ThemeProvider } from 'expo-router/react-navigation'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { useColorScheme } from 'react-native'
import { Uniwind } from 'uniwind'
import {
  navigationDarkTheme,
  navigationLightTheme,
} from '@/modules/theme/navigation'
import { initWssBootstrap } from '@/modules/wss/bootstrap'

// Follow the OS light/dark preference. Uniwind ignores
// `@media (prefers-color-scheme)` in CSS; the active theme is chosen
// via this API. `'system'` re-evaluates on every OS setting change
// (Appearance.addChangeListener under the hood) so no other wiring
// is needed. Called at module load so the first render already sees
// the right theme instead of flashing light then swapping.
Uniwind.setTheme('system')

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
  // Wire the reactive `$device` → `autoConnect` subscription once at
  // app boot. From then on, any device transition — cold-start load
  // from secure-store, a fresh pair completing, a Revoke clearing
  // the record — routes through the subscription in bootstrap.ts,
  // so the paired state is a single atom-of-truth and the UI
  // switches seamlessly without a manual restart. useEffect
  // exception: boot-time side effect syncing an external store
  // (secure storage + WSS session) into the running app, one of
  // CLAUDE.md's explicit "legitimate useEffect" cases.
  useEffect(() => {
    void initWssBootstrap()
  }, [])
  // Reactively pick the react-navigation theme so the header + tab
  // bar chrome shares the same OS-driven light/dark preference the
  // rest of the app follows via Uniwind. useColorScheme subscribes to
  // Appearance under the hood; Uniwind also drives Appearance via
  // setColorScheme, so the two sources agree by construction.
  const scheme = useColorScheme()
  const navTheme =
    scheme === 'dark' ? navigationDarkTheme : navigationLightTheme
  return (
    <ActionSheetProvider>
      <ThemeProvider value={navTheme}>
        {/* biome-ignore lint/complexity/noUselessFragments: ActionSheetProvider */}
        {/* uses React.Children.only internally, so the sibling StatusBar + */}
        {/* Stack must be wrapped as a single fragment child. */}
        <>
          <StatusBar style="auto" />
          <Stack>
            <Stack.Screen name="index" options={{ title: 'Agent Terminal' }} />
            <Stack.Screen
              name="pair"
              options={{ title: 'Pair with desktop' }}
            />
            <Stack.Screen
              name="connect"
              options={{ title: 'Manual connect' }}
            />
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
      </ThemeProvider>
    </ActionSheetProvider>
  )
}
