import '../../global.css'
import { ActionSheetProvider } from '@expo/react-native-action-sheet'
import { Stack } from 'expo-router'
import { ThemeProvider } from 'expo-router/react-navigation'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { useColorScheme } from 'react-native'
import { Uniwind } from 'uniwind'
import { loadSessionView } from '@/modules/stores/$sessionView'
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

// Restore the Workspaces / Recent choice at module load, like the theme
// above, so the sheet opens on the view the user left it on rather than
// flashing the default and swapping. Fire and forget: a preference that
// cannot be read is not worth a failure path.
void loadSessionView()

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
  // Wire the reactive `$activeDevice` → `autoConnect` subscription once at
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
  // rest of the app follows via Uniwind. Both signals (useColorScheme
  // and Uniwind's `setTheme('system')`) resolve from React Native's
  // Appearance module, so the header theme stays in sync with the app
  // body without any extra wiring.
  const scheme = useColorScheme()
  const navTheme =
    scheme === 'dark' ? navigationDarkTheme : navigationLightTheme
  return (
    <ActionSheetProvider>
      <ThemeProvider value={navTheme}>
        {/* biome-ignore lint/complexity/noUselessFragments: ActionSheetProvider uses React.Children.only internally, so the sibling StatusBar + Stack must be wrapped as a single fragment child. */}
        <>
          <StatusBar style="auto" />
          <Stack>
            {/* Renders no UI; redirects to the last session or to home. */}
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen
              name="pair"
              options={{ title: 'Pair with desktop' }}
            />
            <Stack.Screen
              name="connect"
              options={{ title: 'Manual connect' }}
            />
            <Stack.Screen name="home" options={{ title: 'Agent Terminal' }} />
            {/* No header. Every point the navigation bar takes is a point
                of scrollback the terminal does not get, and ActiveTabBar
                already names the session the header would have titled.
                Going back still works: the iOS edge swipe stays enabled
                without a header, and Android keeps its system back. */}
            <Stack.Screen
              name="tab/[projectId]/[tabId]"
              options={{ headerShown: false }}
            />
            {/* Sheets. `headerShown: false` is not cosmetic: Android does
                not render headers inside a form sheet at all, so a title
                set here would simply vanish there. The switcher is the
                only one opened to glance at, so it alone gets the
                half-height first detent; the rest open at full height
                because you arrive at them with an intent. Android caps
                detents at three. */}
            <Stack.Screen
              name="switcher"
              options={{
                presentation: 'formSheet',
                sheetAllowedDetents: [0.5, 1],
                sheetInitialDetentIndex: 0,
                sheetGrabberVisible: true,
                sheetCornerRadius: 16,
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="desktops"
              options={{
                presentation: 'formSheet',
                sheetGrabberVisible: true,
                sheetCornerRadius: 16,
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="project/[projectId]/edit"
              options={{
                presentation: 'formSheet',
                sheetGrabberVisible: true,
                sheetCornerRadius: 16,
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="status/[projectId]/[tabId]"
              options={{
                presentation: 'formSheet',
                sheetGrabberVisible: true,
                sheetCornerRadius: 16,
                headerShown: false,
              }}
            />
          </Stack>
        </>
      </ThemeProvider>
    </ActionSheetProvider>
  )
}
