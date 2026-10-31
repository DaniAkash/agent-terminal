import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { requestInterrupt } from '@/modules/work/$interrupt'
import { collectActiveWork } from '@/modules/work/active-work'

/**
 * Hold the window open when closing it would kill live work.
 *
 * Tauri destroys the window itself when the handler does not prevent
 * the event, so the quiet path needs no code here: with nothing running
 * the close goes through untouched.
 */
export function useQuitGuard(): void {
  // Subscribing to a window event is the external-system case an effect
  // exists for, and the listener has to outlive every render.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false

    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (collectActiveWork($projects.get(), $tabMeta.get()).length === 0)
          return
        event.preventDefault()
        requestInterrupt({ kind: 'quit' })
      })
      .then((off) => {
        if (disposed) off()
        else unlisten = off
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])
}
