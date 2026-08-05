import { useEffect } from 'react'
import { $metaHeld } from '@/modules/stores/$keyboard'

/**
 * Mirrors physical Cmd-key state into `$metaHeld` so the sidebar can
 * show project-number badges while Cmd is held. The blur listener
 * resets the flag if the window loses focus mid-hold, preventing a
 * stuck overlay.
 */
export function useMetaHeldTracker(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Meta') $metaHeld.set(true)
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Meta') $metaHeld.set(false)
    }
    function onBlur() {
      $metaHeld.set(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
