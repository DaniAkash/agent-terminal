import { useStore } from '@nanostores/react'
import { RefreshCw } from 'lucide-react'
import { useEffect, useReducer } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { $jarvis, refreshJarvis, startJarvis } from '@/modules/jarvis/store'
import { JarvisSettings } from './JarvisSettings'
import { JarvisUsage } from './JarvisUsage'

export function JarvisDialog({
  priorityProviderId,
}: {
  priorityProviderId?: string | null
}) {
  const { open, view, snapshot, loading, saving, error } = useStore($jarvis)
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!open) return
    const interval = window.setInterval(tick, 30_000)
    return () => window.clearInterval(interval)
  }, [open])
  const problem = error ?? snapshot?.settingsError
  return (
    <Dialog open={open} onOpenChange={(next) => $jarvis.setKey('open', next)}>
      <DialogContent
        className="jarvis-surface flex max-h-[min(760px,calc(100dvh-2rem))] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]"
        style={{ fontFamily: 'var(--font-ui)' }}
      >
        <div className="jarvis-header jarvis-dialog-header">
          <DialogHeader className="flex-row items-center gap-3">
            <div>
              <DialogTitle className="font-semibold text-lg tracking-tight">
                Jarvis
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                {view === 'settings' ? 'Settings' : 'Usage'}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="jarvis-header-actions">
            <div className="flex gap-1">
              {(['usage', 'settings'] as const).map((tab) => (
                <Button
                  key={tab}
                  variant={view === tab ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 px-3 text-xs capitalize"
                  aria-pressed={view === tab}
                  onClick={() => $jarvis.setKey('view', tab)}
                >
                  {tab}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 text-muted-foreground text-xs"
              disabled={
                loading ||
                saving ||
                !snapshot?.preferences.enabled ||
                snapshot.refreshing ||
                snapshot.preferences.providers.length === 0
              }
              onClick={() => void refreshJarvis()}
            >
              <RefreshCw
                size={12}
                aria-hidden="true"
                className={cn(
                  snapshot?.refreshing && 'motion-safe:animate-spin',
                )}
              />
              {snapshot?.refreshing ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
        </div>
        {problem && (
          <div
            role="alert"
            className="shrink-0 border-border/60 border-b bg-muted/50 px-5 py-3 text-destructive text-xs leading-relaxed"
          >
            {problem}
            {!snapshot && (
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => void startJarvis()}
              >
                Retry
              </button>
            )}
          </div>
        )}
        <div
          className="min-h-0 overflow-y-auto px-5"
          aria-busy={loading || saving}
        >
          {loading && (
            <p className="py-8 text-center text-[12px] text-muted-foreground">
              Loading Jarvis…
            </p>
          )}
          {snapshot &&
            (view === 'settings' ? (
              <JarvisSettings snapshot={snapshot} />
            ) : (
              <JarvisUsage
                snapshot={snapshot}
                priorityProviderId={priorityProviderId}
              />
            ))}
        </div>
        <div className="flex shrink-0 items-center justify-between border-border/60 border-t px-5 py-2.5 text-[11px] text-muted-foreground">
          <span>
            {snapshot?.preferences.providers.length ?? 0} providers selected
          </span>
          <span aria-live="polite">
            {saving ? 'Saving…' : 'Account limits · includes other devices'}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
