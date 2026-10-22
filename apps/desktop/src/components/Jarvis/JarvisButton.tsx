import { PreviewCard } from '@base-ui/react/preview-card'
import { useStore } from '@nanostores/react'
import { Gauge } from 'lucide-react'
import { useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  isCurrent,
  mostConstrained,
  STATUS_LABEL,
} from '@/modules/jarvis/helpers'
import { $jarvis, openJarvis } from '@/modules/jarvis/store'
import { $activeUsageProviderId } from '@/modules/jarvis/terminal-context'
import { JarvisDialog } from './JarvisDialog'
import { JarvisHover } from './JarvisHover'

export function JarvisButton() {
  const { snapshot, open } = useStore($jarvis)
  const activeProviderId = useStore($activeUsageProviderId)
  const [hoverOpen, setHoverOpen] = useState(false)
  const metric = mostConstrained(
    snapshot,
    undefined,
    activeProviderId,
    'hourly',
  )
  const activeProvider = snapshot?.providers.find(
    (provider) => provider.id === activeProviderId,
  )
  const providerStatus = activeProvider
    ? activeProvider.status === 'available' && !isCurrent(activeProvider)
      ? STATUS_LABEL.stale
      : STATUS_LABEL[activeProvider.status]
    : 'Unavailable'
  const label = metric
    ? `${metric.provider.name} · ${Math.round(100 - metric.window.usedPercent)}% left`
    : activeProviderId
      ? `${activeProvider?.name ?? activeProviderId} · ${providerStatus}`
      : 'Jarvis'
  return (
    <>
      <PreviewCard.Root
        open={hoverOpen && !open}
        onOpenChange={(next) => setHoverOpen(next && !open)}
      >
        <PreviewCard.Trigger
          render={<button type="button" />}
          delay={200}
          closeDelay={200}
          onClick={() => {
            setHoverOpen(false)
            openJarvis()
          }}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            'gap-1.5 px-2 font-medium text-[11px] text-muted-foreground',
          )}
          style={{ fontFamily: 'var(--font-ui)' }}
          aria-label={`Open Jarvis usage and settings · ${label}`}
        >
          <Gauge size={14} aria-hidden="true" className="shrink-0" />
          <span className="max-w-40 truncate tabular-nums">{label}</span>
        </PreviewCard.Trigger>
        <PreviewCard.Portal>
          <PreviewCard.Positioner
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="z-50"
          >
            <PreviewCard.Popup className="jarvis-hover-popup flex outline-none">
              <JarvisHover
                snapshot={snapshot}
                priorityProviderId={activeProviderId}
              />
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>
      <JarvisDialog priorityProviderId={activeProviderId} />
    </>
  )
}
