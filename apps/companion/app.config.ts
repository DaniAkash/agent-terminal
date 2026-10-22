import type { ExpoConfig } from 'expo/config'
import { version } from './package.json'

// Dev and production builds install side by side, so the identifier is the
// only thing that distinguishes them. Everything else about the two builds
// is identical on purpose: a variant that differs in behaviour stops being
// a rehearsal for the release.
const isProd = process.env.APP_VARIANT === 'production'
const suffix = isProd ? '' : '.dev'

// Play rejects a versionCode it has already seen, so CI derives this from
// the release tag rather than from anything in the tree. The local fallback
// is only ever used by builds that never reach a store.
const buildNumber = process.env.BUILD_NUMBER ?? '1'

const config: ExpoConfig = {
  name: 'Agent Terminal',
  slug: 'companion',
  version,
  scheme: 'agent-terminal-companion',
  experiments: { typedRoutes: true },
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    // Keeps `.companion`, unlike Android. The desktop app already owns
    // `com.daniakash.agent-terminal` as its bundle id, and on Apple that is
    // a real collision.
    bundleIdentifier: `com.daniakash.agent-terminal.companion${suffix}`,
    supportsTablet: false,
    buildNumber,
    infoPlist: {
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
      NSLocalNetworkUsageDescription:
        'Agent Terminal connects to your desktop over your local Wi-Fi to stream terminal output. No traffic leaves your network.',
    },
  },
  android: {
    // No `.companion` here, and not an oversight: hyphens are illegal in
    // Android package names, so this is the direct translation of the
    // desktop's `com.daniakash.agent-terminal`. The desktop never ships to
    // Android, so the two cannot collide. Bound permanently to the Play
    // listing by the first upload.
    package: `com.daniakash.agent_terminal${suffix}`,
    versionCode: Number(buildNumber),
    adaptiveIcon: {
      backgroundColor: '#0A0B0C',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Pulled in transitively, never used by this app, and each one costs a
    // question on the Play Data Safety form that we would have to answer
    // about behaviour we do not have. Removing them keeps the declared
    // surface equal to the real one.
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-camera',
      {
        cameraPermission:
          'Agent Terminal uses the camera to scan the pairing QR shown on your desktop.',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          networkSecurityConfig: './network-security-config.xml',
        },
      },
    ],
    './plugins/withIosDeploymentTarget',
    './plugins/withGradleWrapperVersion',
    './plugins/withAndroidRelease',
  ],
}

export default config
