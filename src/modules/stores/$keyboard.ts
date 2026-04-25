import { atom } from 'nanostores'

/**
 * True while the Ctrl key is physically held down.
 * Drives the project-number overlay in the sidebar so users can see which
 * Ctrl+N shortcut maps to which project before pressing the digit.
 */
export const $ctrlHeld = atom<boolean>(false)
