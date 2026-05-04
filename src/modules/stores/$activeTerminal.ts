import { atom } from 'nanostores'
import type { XTermHandle } from '@/components/XTermTerminal/XTermTerminal'

/**
 * Handle of the terminal whose tab is currently active and visible.
 * Set by TerminalPane when its `isActive` prop is true; cleared on unmount or
 * deactivation. Global hotkey handlers (Cmd+K, Cmd+A, Cmd+F) call into this
 * handle to dispatch terminal-scoped actions without threading refs.
 */
export const $activeTerminalHandle = atom<XTermHandle | null>(null)
