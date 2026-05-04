import { atom } from 'nanostores'

/**
 * True while the Cmd (Meta) key is physically held down.
 * Drives the project-number overlay in the sidebar so users can see which
 * Cmd+N shortcut maps to which project before pressing the digit.
 */
export const $metaHeld = atom<boolean>(false)
