import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'
import { isLinux } from '@/modules/platform'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { requestInterrupt } from '@/modules/work/$interrupt'
import { collectActiveWork } from '@/modules/work/active-work'
import { handleCloseRequest } from '@/modules/work/close-guard'
import { quitApp } from '@/modules/work/quit-app'

/** Emitted by the Rust side for a quit it has held back. */
const QUIT_REQUESTED = 'app://quit-requested'

function hasActiveWork(): boolean {
  return collectActiveWork($projects.get(), $tabMeta.get()).length > 0
}

/**
 * Hold the app open when leaving would kill live work.
 *
 * Two routes in, because macOS has two. Closing the window raises the
 * window's own close-requested event. On Linux, quit explicitly while the
 * webview is still alive rather than leaving an exit request without a listener.
 * Cmd+Q, the menubar Quit and the dock terminate the application
 * instead and never reach that event at all, so Rust holds those back
 * and hands them here; nothing closes on that path unless this calls
 * `exit`, including when there is no work to protect.
 */
export function useQuitGuard(): void {
  // Two external event sources that have to outlive every render, which
  // is the case an effect exists for.
  useEffect(() => {
    let disposed = false
    const offs: Array<() => void> = []
    const keep = (off: () => void) => {
      if (disposed) off()
      else offs.push(off)
    }

    void getCurrentWindow()
      .onCloseRequested((event) => {
        handleCloseRequest(isLinux, hasActiveWork(), {
          preventClose: () => event.preventDefault(),
          confirmQuit: () => requestInterrupt({ kind: 'quit' }),
          quit: quitApp,
        })
      })
      .then(keep)

    void listen(QUIT_REQUESTED, () => {
      if (!hasActiveWork()) {
        void quitApp().catch(() => requestInterrupt({ kind: 'quit' }))
        return
      }
      requestInterrupt({ kind: 'quit' })
    }).then(keep)

    return () => {
      disposed = true
      for (const off of offs) off()
    }
  }, [])
}
