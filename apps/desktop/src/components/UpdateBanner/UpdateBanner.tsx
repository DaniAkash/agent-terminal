import { useStore } from '@nanostores/react'
import { X } from 'lucide-react'
import {
  $deferredUpdate,
  $updater,
  resumeDeferredUpdate,
} from '@/modules/updater/$updater'

/**
 * The quiet half of the update surface.
 *
 * Anything that needs a decision (available, downloading, ready to
 * restart) is a dialog now. What is left here is the news with no
 * action attached, plus the way back into an update the user deferred,
 * which is the piece that used to be missing: dismissing set the state
 * to idle and the sticky launch check meant it never returned.
 */
export function UpdateBanner() {
  const state = useStore($updater)
  const deferred = useStore($deferredUpdate)

  const showDeferred = state.kind === 'idle' && deferred !== null
  if (!showDeferred && state.kind !== 'up-to-date' && state.kind !== 'error') {
    return null
  }

  return (
    <div
      className="pointer-events-auto absolute right-3 bottom-9 z-20 flex max-w-md items-start gap-3 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg"
      style={{ fontFamily: 'var(--font-ui)' }}
      role="status"
      aria-live="polite"
    >
      {showDeferred && deferred && (
        <button
          type="button"
          onClick={resumeDeferredUpdate}
          className="flex items-center gap-2 rounded hover:underline"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-primary" />
          {deferred.staged
            ? `Update ${deferred.version} is ready to install`
            : `Update ${deferred.version} is available`}
        </button>
      )}

      {state.kind === 'up-to-date' && (
        <>
          <div className="min-w-0 flex-1">
            You're up to date (v{state.currentVersion}).
          </div>
          <button
            type="button"
            onClick={() => $updater.set({ kind: 'idle' })}
            className="-mr-1 rounded p-1 hover:bg-accent"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </>
      )}

      {state.kind === 'error' && (
        <>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-destructive">
              Couldn't check for updates
            </div>
            <div className="mt-0.5 line-clamp-3 text-muted-foreground">
              {state.message}
            </div>
          </div>
          <button
            type="button"
            onClick={() => $updater.set({ kind: 'idle' })}
            className="-mr-1 rounded p-1 hover:bg-accent"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        </>
      )}
    </div>
  )
}
