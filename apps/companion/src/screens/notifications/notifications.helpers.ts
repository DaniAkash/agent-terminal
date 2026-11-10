import { DELAY_CHOICES } from '@/modules/push/push.types'
import type {
  DesktopPushStatus,
  PushPermission,
  PushSupport,
} from '@/modules/push/push.types'

export type StatusKind =
  | 'unsupported'
  | 'blocked'
  | 'disconnected'
  | 'desktop-too-old'
  | 'desktop-error'
  | 'registering'
  | 'off'
  | 'on'

export interface StatusView {
  kind: StatusKind
  label: string
  detail: string
  tone: 'ok' | 'warn' | 'bad' | 'muted'
  /** Shown as a tappable row when the user can do something about it. */
  action: 'open-system-settings' | 'update-desktop' | null
}

export interface StatusInput {
  support: PushSupport
  permission: PushPermission
  connected: boolean
  desktop: DesktopPushStatus | null
  enabled: boolean
}

/**
 * The one line that says whether push actually works.
 *
 * Order matters, first match wins. Showing "on" while any of these is
 * false is the bug that makes the whole feature look broken: the user
 * sees a switch that is on, gets nothing, and has no way to learn why.
 */
export function statusView(input: StatusInput): StatusView {
  if (input.support === 'unsupported') {
    return {
      kind: 'unsupported',
      label: 'Not available',
      detail: 'This device cannot receive push notifications.',
      tone: 'muted',
      action: null,
    }
  }
  if (input.permission === 'denied') {
    return {
      kind: 'blocked',
      label: 'Blocked',
      // requestPermissionsAsync will not prompt a second time after a
      // denial, so pointing at the OS is the only way forward.
      detail: 'Notifications are turned off for Agent Terminal.',
      tone: 'bad',
      action: 'open-system-settings',
    }
  }
  if (!input.connected) {
    return {
      kind: 'disconnected',
      label: 'Waiting',
      detail: 'Connect to your desktop to finish setting this up.',
      tone: 'muted',
      action: null,
    }
  }
  if (!input.desktop?.supported) {
    return {
      kind: 'desktop-too-old',
      label: 'Unsupported',
      detail: 'Your desktop app is older than this feature.',
      tone: 'warn',
      action: 'update-desktop',
    }
  }
  if (input.desktop.lastError) {
    return {
      kind: 'desktop-error',
      label: 'Failing',
      detail: `Your desktop could not send: ${input.desktop.lastError}`,
      tone: 'bad',
      action: null,
    }
  }
  if (!input.enabled) {
    return {
      kind: 'off',
      label: 'Off',
      detail: 'Your desktop will not notify this phone.',
      tone: 'muted',
      action: null,
    }
  }
  if (!input.desktop.registered) {
    return {
      kind: 'registering',
      label: 'Starting',
      detail: 'Registering this phone with your desktop.',
      tone: 'muted',
      action: null,
    }
  }
  return {
    kind: 'on',
    label: 'On',
    detail: 'Your desktop will notify this phone when you miss one.',
    tone: 'ok',
    action: null,
  }
}

export function formatDelay(seconds: number): string {
  if (seconds === 0) return 'Right away'
  if (seconds < 60) return `${seconds} seconds`
  const minutes = Math.round(seconds / 60)
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

/** Cycles through the offered waits, so the row is one tap rather than
 *  a picker. Wraps at the end. */
export function nextDelay(current: number): number {
  const choices: readonly number[] = DELAY_CHOICES
  const at = choices.indexOf(current)
  // Index arithmetic under noUncheckedIndexedAccess still yields
  // `number | undefined`, so the fallback is a type requirement as
  // well as the unrecognised-value behaviour.
  return choices[(at + 1) % choices.length] ?? choices[0] ?? 0
}
