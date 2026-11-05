import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { $push, setPushPrefs } from './$push'

/**
 * Permission, token, and registration.
 *
 * The OS dialog is requested behind the pairing success screen, never
 * at boot: at boot the user has not paired a desktop and cannot tell
 * why the app wants notifications, so they deny, and
 * `requestPermissionsAsync` never prompts again.
 */

export async function refreshPermission(): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync()
  $push.setKey('permission', toPermission(status))
}

async function requestPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync()
  const permission = toPermission(status)
  $push.setKey('permission', permission)
  return permission === 'granted'
}

function toPermission(status: string) {
  if (status === 'granted') return 'granted' as const
  if (status === 'denied') return 'denied' as const
  return 'undetermined' as const
}

/**
 * Fetch and cache the Expo push token.
 *
 * `getExpoPushTokenAsync` rejects without a project id, which it reads
 * from the app config, so a build without `extra.eas.projectId` cannot
 * register. That is reported as unsupported rather than thrown, so the
 * settings screen can say so instead of the app crashing on a tap.
 */
async function fetchToken(): Promise<string | null> {
  const projectId = resolveProjectId()
  if (!projectId) {
    // Reported rather than thrown: the settings screen says push is
    // unavailable instead of the app crashing on a tap.
    console.warn('[push] no EAS project id in the app config, cannot register')
    $push.setKey('support', 'unsupported')
    return null
  }
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
    $push.setKey('support', 'ok')
    $push.setKey('token', data)
    return data
  } catch (err) {
    console.warn('[push] could not get an Expo push token:', err)
    $push.setKey('support', 'unsupported')
    return null
  }
}

/**
 * `getExpoPushTokenAsync` rejects without a project id. EAS Build fills
 * `easConfig`; a local or CI build fills `extra.eas.projectId` from the
 * environment, so both are checked.
 */
function resolveProjectId(): string | undefined {
  return (
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId
  )
}

/**
 * Turn push on from a user action: permission, then token, then let the
 * registration gate do the rest once the desktop has advertised push.
 */
export async function enablePush(): Promise<boolean> {
  // No platform guess here either: `getExpoPushTokenAsync` failing is
  // the authoritative answer, and `fetchToken` already records it.
  if (!(await requestPermission())) return false
  if (!(await fetchToken())) return false
  await setPushPrefs({ enabled: true })
  return true
}

export function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0'
}

export function platformName(): string {
  return Platform.OS === 'ios' ? 'ios' : 'android'
}
