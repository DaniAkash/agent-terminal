import { useStore } from '@nanostores/react'
import { Download, RefreshCw, X } from 'lucide-react'
import { $updater } from '@/modules/updater/$updater'
import { installUpdate } from '@/modules/updater/installUpdate'

/**
 * Floating banner anchored above the status bar. Renders per `$updater`
 * state — only the user-actionable states (available, downloading,
 * ready-to-install, error, manual-check up-to-date) draw a frame. The
 * idle and silent-checking states render nothing so the chrome stays
 * out of the way until there's something to say.
 */
export function UpdateBanner() {
  const state = useStore($updater)

  if (state.kind === 'idle' || state.kind === 'checking') return null

  return (
    <div
      className="pointer-events-auto absolute right-3 bottom-9 z-20 flex max-w-md items-start gap-3 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg"
      style={{ fontFamily: 'var(--font-ui)' }}
      role="status"
      aria-live="polite"
    >
      {state.kind === 'available' && (
        <>
          <Download size={14} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              Update available — v{state.version}
            </div>
            {state.notes && (
              <div className="mt-0.5 line-clamp-3 text-muted-foreground">
                {state.notes}
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => installUpdate()}
                className="rounded bg-primary px-2 py-1 text-primary-foreground hover:opacity-90"
              >
                Install now
              </button>
              <button
                type="button"
                onClick={() => $updater.set({ kind: 'idle' })}
                className="rounded px-2 py-1 hover:bg-accent"
              >
                Later
              </button>
            </div>
          </div>
        </>
      )}

      {state.kind === 'downloading' && (
        <>
          <RefreshCw
            size={14}
            className="mt-0.5 shrink-0 animate-spin"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              Downloading update… {Math.round(state.progress * 100)}%
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-[width] duration-150"
                style={{ width: `${Math.round(state.progress * 100)}%` }}
              />
            </div>
          </div>
        </>
      )}

      {state.kind === 'ready-to-install' && (
        <>
          <Download size={14} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Update installed — restarting…</div>
          </div>
        </>
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
