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
 * The two states that need an answer (available, ready to restart) are
 * a dialog. Everything that does not is here, including the download
 * progress: a modal backdrop would block the terminal it just told the
 * user to keep working in. Plus the way back into a deferred update,
 * which is the piece that used to be missing: dismissing set the state
 * to idle and the sticky launch check meant it never returned.
 */
export function UpdateBanner() {
  const state = useStore($updater)
  const deferred = useStore($deferredUpdate)

  const showDeferred = state.kind === 'idle' && deferred !== null
  if (
    !showDeferred &&
    state.kind !== 'downloading' &&
    state.kind !== 'up-to-date' &&
    state.kind !== 'error'
  ) {
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
            ? `Update ${deferred.version} installed, restart to finish`
            : `Update ${deferred.version} is available`}
        </button>
      )}

      {state.kind === 'downloading' && (
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            Downloading update {Math.round(state.progress * 100)}%
          </div>
          <div
            className="mt-1 h-1 w-full overflow-hidden rounded bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(state.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{ width: `${Math.round(state.progress * 100)}%` }}
            />
          </div>
        </div>
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
