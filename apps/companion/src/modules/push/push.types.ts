import { z } from 'zod'

/**
 * Routing payload the desktop puts in the Expo message's `data`.
 *
 * This crossed Expo and FCM or APNs before arriving, so it is untrusted
 * input: it gets parsed, never cast. Ids only, no display text, so the
 * phone never has to read a notification's words to decide where to go
 * and the payload stays safe to send with redaction on.
 */
export const pushDataSchema = z.object({
  v: z.literal(1),
  /** The paired-device id this desktop minted for THIS phone. */
  deviceId: z.string().min(1),
  projectId: z.string().min(1),
  /** Raw tab id, project prefix already stripped by the desktop. */
  tabId: z.string().min(1),
  state: z.enum(['awaiting', 'completed', 'error']),
  agentId: z.string().optional(),
  firedAt: z.number(),
  /**
   * Nested-hash MAC over the routing fields, keyed by the pairing
   * secret. Required: Expo needs no access token to send, so an
   * unsigned payload and a badly signed one are the same thing.
   */
  sig: z.string().min(32),
})

export type PushData = z.infer<typeof pushDataSchema>

export type RouteDecision =
  | { kind: 'route'; deviceId: string; href: string; switchDesktop: boolean }
  /** Devices have not hydrated yet. Replay once they have. */
  | { kind: 'park'; data: PushData }
  | {
      kind: 'ignore'
      reason:
        | 'malformed'
        | 'unknown-device'
        | 'unsupported-version'
        | 'bad-signature'
    }

export type PushSupport = 'unknown' | 'unsupported' | 'ok'
export type PushPermission = 'undetermined' | 'granted' | 'denied'

/** Mirrors `ServerFrame::PushStatus`. `null` until the desktop sends one. */
export interface DesktopPushStatus {
  supported: boolean
  registered: boolean
  delaySeconds: number
  redactNames: boolean
  lastError: string | null
}

export interface PushPrefs {
  enabled: boolean
  delaySeconds: number
  redactNames: boolean
}

/**
 * What this phone has told the desktop on the current connection.
 *
 * `PushStatus` carries no token, so the desktop's echo cannot say
 * whether the token it stored is still the one this phone holds. This
 * does: it is the phone's own record of what it last sent, and
 * comparing it to what the phone now wants is what tells an identical
 * echo apart from a rotated token or a changed preference.
 */
export type PushAssertion =
  | {
      kind: 'registered'
      token: string
      delaySeconds: number
      redactNames: boolean
    }
  /** An `UnregisterPush` already went out on this connection. */
  | { kind: 'cleared' }

/**
 * Three minutes. You can be at your desk and heads-down in another
 * window for a long time, and the grace window exists to let you notice
 * on your own before your pocket buzzes.
 */
export const DEFAULT_DELAY_SECONDS = 180

export const DELAY_CHOICES = [0, 30, 60, 120, 180, 300, 600, 900, 1800] as const
