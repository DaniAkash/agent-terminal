type CloseGuardActions = {
  preventClose: () => void
  confirmQuit: () => void
  quit: () => Promise<void>
}

/** Handle a window close while its frontend can still confirm or request exit. */
export function handleCloseRequest(
  linux: boolean,
  activeWork: boolean,
  actions: CloseGuardActions,
): void {
  if (!activeWork && !linux) return
  actions.preventClose()
  if (activeWork) {
    actions.confirmQuit()
  } else {
    void actions.quit().catch(actions.confirmQuit)
  }
}
