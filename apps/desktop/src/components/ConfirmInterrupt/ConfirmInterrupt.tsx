import { useStore } from '@nanostores/react'
import { exit, relaunch } from '@tauri-apps/plugin-process'
import { TriangleAlert } from 'lucide-react'
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
import { $projects, removeTab } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import {
  $interrupt,
  dismissInterrupt,
  type InterruptIntent,
} from '@/modules/work/$interrupt'
import { type ActiveWork, collectActiveWork } from '@/modules/work/active-work'
import { interruptCopy } from '@/modules/work/interrupt.copy'

/**
 * The one confirmation behind quitting, closing a tab and restarting for
 * an update. It names what is about to be interrupted, because "are you
 * sure" is not a question anyone can answer.
 */
export function ConfirmInterrupt() {
  const intent = useStore($interrupt)
  // Split so the body takes a non-null intent as a prop: control flow
  // does not narrow into the click handler otherwise.
  if (!intent) return null
  return <InterruptDialog intent={intent} />
}

function InterruptDialog({ intent }: { intent: InterruptIntent }) {
  const projects = useStore($projects)
  const tabMeta = useStore($tabMeta)

  const all = collectActiveWork(projects, tabMeta)
  const work =
    intent.kind === 'close-tab'
      ? all.filter(
          (w) => w.projectId === intent.projectId && w.tabId === intent.tabId,
        )
      : all
  const copy = interruptCopy(intent, work)

  function onConfirm() {
    dismissInterrupt()
    if (intent.kind === 'quit') {
      void exit(0)
      return
    }
    if (intent.kind === 'restart') {
      void relaunch()
      return
    }
    removeTab(intent.projectId, intent.tabId)
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) dismissInterrupt()
      }}
    >
      <AlertDialogContent className="flex max-h-[min(32rem,calc(100vh-4rem))] flex-col gap-0 sm:max-w-md">
        <AlertDialogHeader className="flex shrink-0 flex-row items-start gap-3 space-y-0 text-left">
          <span
            aria-hidden
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-amber-500"
          >
            <TriangleAlert size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            <AlertDialogDescription className="mt-1.5">
              {copy.description}
            </AlertDialogDescription>
          </span>
        </AlertDialogHeader>

        {/* The number of busy tabs is unbounded, so the list is the only
            thing that scrolls and the buttons stay reachable. */}
        {work.length > 0 && (
          <div className="-mx-1 mt-3.5 min-h-0 flex-1 overflow-y-auto px-1">
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
              {work.map((item) => (
                <WorkRow key={`${item.projectId}:${item.tabId}`} work={item} />
              ))}
            </ul>
          </div>
        )}

        <AlertDialogFooter className="mt-4 shrink-0">
          <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {copy.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function WorkRow({ work }: { work: ActiveWork }) {
  return (
    <li className="flex items-center gap-2.5 bg-card/40 px-2.5 py-2">
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${
          work.reason === 'awaiting' ? 'bg-sky-400' : 'bg-amber-400'
        }`}
      />
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className="block truncate text-xs">
          {work.tabLabel}{' '}
          <span className="text-muted-foreground">{work.projectName}</span>
        </span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">
          {work.detail}
        </span>
      </span>
      {work.elapsed && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {work.elapsed}
        </span>
      )}
    </li>
  )
}
