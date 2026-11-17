import { Smartphone } from 'lucide-react'
import {
  addressLine,
  deviceLine,
} from '@/components/Companion/companion.helpers'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { MobileSubscriberInfo } from '@/modules/stores/$mobileActivity'

const TONE = {
  online: {
    icon: 'text-muted-foreground/80',
    dot: 'bg-emerald-500',
    headerDot: 'bg-emerald-400',
    badge: 'bg-emerald-500/20 text-emerald-300',
    label: 'Online',
  },
  idle: {
    icon: 'text-muted-foreground/45',
    dot: 'bg-amber-500/80',
    headerDot: 'bg-amber-400',
    badge: 'bg-amber-500/20 text-amber-300',
    label: 'Idle',
  },
} as const

/**
 * Muted mobile icon indicator shown on sidebar folder rows and tab chips when
 * one or more paired mobile devices are viewing or idle on the session.
 * Hovering reveals the connected mobile device details and Online/Idle state.
 */
export function MobileSessionIndicator({
  devices,
  side = 'right',
}: {
  devices: MobileSubscriberInfo[]
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  if (devices.length === 0) return null

  const tone =
    TONE[devices.some((d) => d.status === 'online') ? 'online' : 'idle']

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="img"
              aria-label={`Mobile ${tone.label.toLowerCase()}`}
              className={cn(
                'hover:text-foreground relative flex shrink-0 items-center transition-colors',
                tone.icon,
              )}
            >
              <Smartphone size={11} />
              <span
                className={cn(
                  'border-sidebar absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full border',
                  tone.dot,
                )}
              />
            </span>
          }
        />
        <TooltipContent
          side={side}
          sideOffset={6}
          className="flex-col items-start gap-1.5 py-2"
        >
          <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase opacity-80">
            <span className={cn('size-1.5 rounded-full', tone.headerDot)} />
            <span>Mobile · {tone.label}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {devices.map((dev) => {
              const devTone = TONE[dev.status]
              return (
                <div
                  key={dev.device_id ?? dev.connection_id}
                  className="flex flex-col leading-tight"
                >
                  <div className="flex items-center gap-1.5 font-medium">
                    <span>{dev.device_name}</span>
                    <span
                      className={cn(
                        'rounded px-1 text-[9px] font-semibold uppercase',
                        devTone.badge,
                      )}
                    >
                      {devTone.label}
                    </span>
                  </div>
                  <span className="text-[10px] opacity-75">
                    {deviceLine(dev.platform, dev.model)}
                  </span>
                  {addressLine(dev.peer_ip) && (
                    <span className="text-[10px] opacity-75">
                      {addressLine(dev.peer_ip)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
