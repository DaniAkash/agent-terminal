type CloseGuardActions = {
  preventClose: () => void
  hide: () => Promise<void>
  confirmQuit: () => void
  quit: () => Promise<void>
}

/**
 * Handle a window close while its frontend can still confirm or request exit.
 *
 * The close button means "put this away", not "end the session". On macOS
 * and Windows the window hides to the menu bar or tray with the PTYs, the
 * agents and the sidecar all still running, and the tray is how it comes
 * back. Linux keeps quit-on-close: tray support there is inconsistent, and
 * leaving somebody with neither a window nor a tray is worse than leaving
 * the behaviour alone.
 *
 * This is the only place the close is decided. A second handler on the Rust
 * side would be a second opinion on one event, which is how a close button
 * ends up quitting some of the time.
 */
export function handleCloseRequest(
  linux: boolean,
  activeWork: boolean,
  actions: CloseGuardActions,
): void {
  // Hiding cannot lose work, so there is nothing to confirm. Every prompt
  // moves to quit, which is the only action that kills anything.
  if (!linux) {
    actions.preventClose()
    void actions.hide()
    return
  }
  actions.preventClose()
  if (activeWork) {
    actions.confirmQuit()
  } else {
    void actions.quit().catch(actions.confirmQuit)
  }
}

/**
 * Whether a quit the backend held back must be confirmed even with nothing
 * running.
 *
 * Quit from the tray always asks, because the window it would close is one
 * the user cannot see: the usual "nothing is running, just go" shortcut
 * would make the menu item a one-click way to kill a session they had only
 * put away. Cmd+Q, the dock and the app menu keep that shortcut and send
 * no flag.
 */
export function quitNeedsConfirmation(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'confirm' in payload &&
    (payload as { confirm: unknown }).confirm === true
  )
}
