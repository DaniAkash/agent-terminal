import { atom } from 'nanostores'

/**
 * The one pending "this would interrupt work" question.
 *
 * A store rather than local state at each call site: quitting is raised
 * from a window event, closing a tab from three different components,
 * and the update restart from a dialog. They all need one confirmation,
 * rendered once at the app root.
 *
 * The intent is plain data, not a callback. A callback would capture the
 * render that created it and could not survive a hot reload.
 */
export type InterruptIntent =
  | { kind: 'quit' }
  | { kind: 'restart' }
  | { kind: 'close-tab'; projectId: string; tabId: string }

export const $interrupt = atom<InterruptIntent | null>(null)

export function requestInterrupt(intent: InterruptIntent): void {
  $interrupt.set(intent)
}

export function dismissInterrupt(): void {
  $interrupt.set(null)
}
