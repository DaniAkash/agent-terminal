import AsyncStorage from '@react-native-async-storage/async-storage'
import { map } from 'nanostores'
import {
  DEFAULT_DELAY_SECONDS,
  type DesktopPushStatus,
  type PushData,
  type PushPermission,
  type PushPrefs,
  type PushSupport,
} from './push.types'

const PREFS_KEY = 'agent-terminal:push:prefs'

export interface PushState {
  /** `unsupported` means a simulator without Play services, or a
   *  platform that cannot register at all. */
  support: PushSupport
  permission: PushPermission
  token: string | null
  /** From `ServerFrame::PushStatus`. `null` means this desktop never
   *  advertised push, which is how an older Mac app presents. */
  desktop: DesktopPushStatus | null
  /** Local and user-chosen. Re-asserted on every connect, which doubles
   *  as the recovery path when a desktop lost its record. */
  prefs: PushPrefs
  /** A tap that arrived before `$devices` hydrated, replayed by the
   *  resolver once it has. */
  pendingRoute: PushData | null
}

export const $push = map<PushState>({
  support: 'unknown',
  permission: 'undetermined',
  token: null,
  desktop: null,
  prefs: {
    // Off until the user turns it on: doing so is their consent to
    // notification text leaving the local network, asked for once
    // behind the pairing success screen.
    enabled: false,
    delaySeconds: DEFAULT_DELAY_SECONDS,
    redactNames: false,
  },
  pendingRoute: null,
})

export async function loadPushPrefs(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<PushPrefs>
    $push.setKey('prefs', {
      enabled: parsed.enabled === true,
      delaySeconds:
        typeof parsed.delaySeconds === 'number'
          ? parsed.delaySeconds
          : DEFAULT_DELAY_SECONDS,
      redactNames: parsed.redactNames === true,
    })
  } catch {
    // A preference that cannot be read is not worth a failure path.
  }
}

export async function setPushPrefs(next: Partial<PushPrefs>): Promise<void> {
  const prefs = { ...$push.get().prefs, ...next }
  $push.setKey('prefs', prefs)
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Same: the in-memory value still applies to this session.
  }
}

export function takePendingRoute(): PushData | null {
  const pending = $push.get().pendingRoute
  if (pending) $push.setKey('pendingRoute', null)
  return pending
}
