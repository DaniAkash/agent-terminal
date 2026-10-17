import { AlertCircle, ArrowUpRight, Gauge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { mostConstrained, prioritizeProvider } from '@/modules/jarvis/helpers'
import { $jarvis } from '@/modules/jarvis/store'
import type { UsageSnapshot } from '@/modules/jarvis/types'
import { JarvisProvider } from './JarvisProvider'

/** Same quota presentation in the main dialog and the lightweight tray window. */
export function JarvisUsage({
  snapshot,
  onManage,
  priorityProviderId,
}: {
  snapshot: UsageSnapshot
  onManage?: (settings: boolean) => void
  priorityProviderId?: string | null
}) {
  const selected = snapshot.providers.filter((provider) =>
    snapshot.preferences.providers.includes(provider.id),
  )
  const metric = mostConstrained(snapshot)
  if (!snapshot.preferences.enabled || selected.length === 0) {
    return (
      <div className="py-10 text-center">
        <Gauge
          size={28}
          aria-hidden="true"
          className="mx-auto mb-3 text-muted-foreground/60"
        />
        <p className="mb-1 font-medium text-[13px]">
          {snapshot.preferences.enabled
            ? 'Choose your providers'
            : 'Jarvis is paused'}
        </p>
        <p className="mb-4 text-[11px] text-muted-foreground">
          Select your providers in settings to see their limits.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5 text-[11px]"
          onClick={() =>
            onManage ? onManage(true) : $jarvis.setKey('view', 'settings')
          }
        >
          Open settings <ArrowUpRight size={12} aria-hidden="true" />
        </Button>
      </div>
    )
  }
  return (
    <div className="jarvis-usage">
      {metric && metric.window.usedPercent >= 75 && (
        <div className="jarvis-quota-notice">
          <AlertCircle size={15} aria-hidden="true" />
          <p>
            <strong>{metric.provider.name}</strong> · {metric.window.label} has{' '}
            {Math.round(100 - metric.window.usedPercent)}% left
          </p>
        </div>
      )}
      <div className="jarvis-providers">
        {prioritizeProvider(selected, priorityProviderId).map((provider) => (
          <JarvisProvider
            key={provider.id}
            provider={provider}
            onManage={onManage}
          />
        ))}
      </div>
    </div>
  )
}
