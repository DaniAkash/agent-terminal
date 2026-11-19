import { atom } from 'nanostores'

/**
 * Set when the desktop removed this phone (Revoke in its Companion
 * dialog, or a token it no longer knows). The pairing is gone by then;
 * this keeps the reason, so the phone can say who ended it instead of
 * dropping to the first-run screen as if nothing had happened.
 */
export const $removal = atom<{ desk: string } | null>(null)

export function noteRemoval(desk: string): void {
  $removal.set({ desk })
}

export function clearRemoval(): void {
  $removal.set(null)
}
