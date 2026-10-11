import { useStore } from '@nanostores/react'
import { ArrowUpRight, RefreshCw, Settings2, X } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { JarvisIPC } from '@/modules/jarvis/api'
import { $jarvis, refreshJarvis } from '@/modules/jarvis/store'
import { JarvisUsage } from './JarvisUsage'

/** Isolated tray renderer: no workspace, terminal, WSS, or mod subscriptions. */
export function JarvisTray() {
  const { snapshot, error, loading } = useStore($jarvis)
  const problem = error ?? snapshot?.trayError ?? snapshot?.settingsError
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void JarvisIPC.dismissTray()
    }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [])
  const manage = (settings: boolean) => {
    void JarvisIPC.openMain(settings).catch(() => {
      $jarvis.setKey(
        'error',
        'Could not open Agent Terminal. Try the tray menu.',
      )
    })
  }
  return (
    <main className="jarvis-surface flex h-dvh flex-col overflow-hidden rounded-xl border border-border text-foreground">
      <header className="jarvis-header flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div>
            <h1 className="font-semibold text-lg tracking-tight">Jarvis</h1>
            <p className="mt-0.5 text-muted-foreground text-xs">Usage</p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Jarvis settings"
            onClick={() => manage(true)}
          >
            <Settings2 size={14} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss usage panel"
            onClick={() => void JarvisIPC.dismissTray()}
          >
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3" aria-busy={loading}>
        {problem && (
          <div
            className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-muted-foreground text-xs"
            role="alert"
          >
            {problem}
            <button
              type="button"
              className="mt-2 block text-foreground underline"
              onClick={() => manage(true)}
            >
              Open settings in Agent Terminal
            </button>
          </div>
        )}
        {loading && (
          <p className="py-8 text-center text-[11px] text-muted-foreground">
            Reading usage…
          </p>
        )}
        {snapshot && <JarvisUsage snapshot={snapshot} onManage={manage} />}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-2 border-border border-t px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => void refreshJarvis()}
          disabled={
            !snapshot?.preferences.enabled ||
            snapshot.refreshing ||
            snapshot.preferences.providers.length === 0
          }
        >
          <RefreshCw
            size={12}
            aria-hidden="true"
            className={snapshot?.refreshing ? 'motion-safe:animate-spin' : ''}
          />
          {snapshot?.refreshing ? 'Refreshing' : 'Refresh'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground text-xs"
          onClick={() => manage(false)}
        >
          Agent Terminal <ArrowUpRight size={12} aria-hidden="true" />
        </Button>
      </footer>
    </main>
  )
}
