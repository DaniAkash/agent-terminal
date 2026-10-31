import { useStore } from '@nanostores/react'
import { relaunch } from '@tauri-apps/plugin-process'
import { Download, RotateCw } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { $updater, deferUpdate } from '@/modules/updater/$updater'
import { installUpdate } from '@/modules/updater/installUpdate'
import { requestInterrupt } from '@/modules/work/$interrupt'
import { collectActiveWork } from '@/modules/work/active-work'

/**
 * The update, as two decisions instead of one button.
 *
 * Downloading and restarting used to be a single action, so taking an
 * update could end a running turn with no warning. They are separate
 * here, and the restart goes through the same guard as quitting.
 */
export function UpdateDialog() {
  const state = useStore($updater)
  const projects = useStore($projects)
  const tabMeta = useStore($tabMeta)

  if (
    state.kind !== 'available' &&
    state.kind !== 'downloading' &&
    state.kind !== 'ready-to-restart'
  ) {
    return null
  }

  function onRestart() {
    if (collectActiveWork(projects, tabMeta).length > 0) {
      $updater.set({ kind: 'idle' })
      requestInterrupt({ kind: 'restart' })
      return
    }
    void relaunch()
  }

  return (
    <AlertDialog open>
      <AlertDialogContent className="flex max-h-[min(32rem,calc(100vh-4rem))] flex-col gap-0 sm:max-w-md">
        <AlertDialogHeader className="flex shrink-0 flex-row items-start gap-3 space-y-0 text-left">
          <span
            aria-hidden
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-primary"
          >
            {state.kind === 'ready-to-restart' ? (
              <RotateCw size={17} />
            ) : (
              <Download size={17} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <AlertDialogTitle>
              {state.kind === 'available' &&
                `Version ${state.version} is available`}
              {state.kind === 'downloading' && 'Downloading the update'}
              {state.kind === 'ready-to-restart' &&
                'Restart to finish the update'}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-1.5">
              {state.kind === 'available' &&
                'Downloads in the background. Nothing restarts until you say so.'}
              {state.kind === 'downloading' &&
                'You can keep working. The restart is still yours to make.'}
              {state.kind === 'ready-to-restart' &&
                `Version ${state.version} is installed and runs after a restart.`}
            </AlertDialogDescription>
          </span>
        </AlertDialogHeader>

        {state.kind === 'available' && state.notes && (
          <div className="-mx-1 mt-3.5 min-h-0 flex-1 overflow-y-auto px-1">
            <p className="whitespace-pre-line rounded-md border border-border bg-card/40 px-2.5 py-2 text-muted-foreground text-xs">
              {state.notes}
            </p>
          </div>
        )}

        {state.kind === 'downloading' && (
          <div
            className="mt-3.5 h-1 w-full shrink-0 overflow-hidden rounded-full bg-muted"
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
        )}

        <AlertDialogFooter className="mt-4 shrink-0">
          {state.kind === 'available' && (
            <>
              <AlertDialogCancel
                onClick={() => deferUpdate(state.version, false)}
              >
                Remind me later
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => void installUpdate()}>
                Download update
              </AlertDialogAction>
            </>
          )}
          {state.kind === 'ready-to-restart' && (
            <>
              <AlertDialogCancel
                onClick={() => deferUpdate(state.version, true)}
              >
                Not now
              </AlertDialogCancel>
              <AlertDialogAction onClick={onRestart}>
                Restart now
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
