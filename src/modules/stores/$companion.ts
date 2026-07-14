import { map } from 'nanostores'
import type {
  PairedDevice,
  PairingQrPayload,
} from '@/components/Companion/companion.types'

/**
 * Companion dialog state. `open` gates the shadcn Dialog; `payload`
 * holds the currently-live pairing QR (null between sessions).
 * `devices` is the last-known paired-devices list refreshed on
 * dialog open, on `pairing:complete`, and on Revoke.
 */
export interface CompanionState {
  open: boolean
  payload: PairingQrPayload | null
  devices: PairedDevice[]
  /** Non-null when the last IPC failed; the dialog surfaces it inline. */
  error: string | null
  /** True while a Tauri command is inflight. */
  loading: boolean
}

export const $companion = map<CompanionState>({
  open: false,
  payload: null,
  devices: [],
  error: null,
  loading: false,
})
