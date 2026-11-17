import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'
import { IPC } from '@/modules/ipc/commands'
import {
  $activeTabKey,
  getActiveTerminalHandle,
} from '@/modules/stores/$activeTerminal'

/**
 * Re-fit the active terminal when the window comes back to the front, and
 * re-declare its viewport to the backend.
 *
 * The window can change size while the app is in the background: another
 * space, a display plugged or unplugged, a tiling manager, or the user
 * dragging the frame of a window they are not looking at. wterm resizes
 * off a ResizeObserver, which already covers the pane that is on screen,
 * so this is for the cases that observer cannot see rather than a second
 * copy of what it does.
 *
 * The declaration is unconditional because `fit()` is not: it only reports
 * a grid that actually changed, so a window that was hidden and shown
 * again at the same size would tell the backend nothing. The hub ignores a
 * declaration that does not move the decision, which makes the extra call
 * free and the silent case impossible.
 *
 * Only the active pane is fitted. The rest are `display: none` and have
 * no box to measure; each re-fits itself when its own tab is focused.
 */
export function useFitOnWindowFocus(): void {
  // One listener for the app rather than one per pane: the handles are
  // already in a registry, and only the active one can be measured.
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (!payload) return
      // On the next frame, so the pane is measured at the size it has
      // once the window is front rather than the one it had behind.
      requestAnimationFrame(() => {
        const handle = getActiveTerminalHandle()
        handle?.fit()
        const tabKey = $activeTabKey.get()
        const size = handle?.getSize()
        if (!tabKey || !size) return
        IPC.resizePty(tabKey, size.cols, size.rows).catch(() => {})
      })
    })
    return () => {
      unlisten.then((off) => off()).catch(() => {})
    }
  }, [])
}
