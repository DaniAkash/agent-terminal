import { useStore } from '@nanostores/react'
import { Smartphone } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  $activeMobileTabs,
  getAllMobileDevices,
} from '@/modules/stores/$mobileActivity'
import { openCompanionDialog } from './companion.data'

/**
 * StatusBar entry point to the Companion dialog. Sits next to
 * <ThemeToggle> in StatusBarLeft. Shows a subtle emerald/amber status dot
 * when a paired mobile device is currently Online or Idle.
 */
export function CompanionButton() {
  const activeMobileTabs = useStore($activeMobileTabs)
  const devices = getAllMobileDevices(activeMobileTabs)
  const anyOnline = devices.some((d) => d.status === 'online')
  const hasDevices = devices.length > 0

  const title = hasDevices
    ? devices.map((d) => `${d.device_name} (${d.status})`).join(', ')
    : 'Pair a mobile device'

  return (
    <button
      type="button"
      onClick={() => {
        void openCompanionDialog()
      }}
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'sm' }),
        'group text-muted-foreground relative gap-1.5 px-2.5 text-[11px] font-medium',
      )}
      style={{ fontFamily: 'var(--font-ui)' }}
      aria-label="Companion pairing"
      title={title}
    >
      <span className="relative inline-flex items-center">
        <Smartphone size={14} aria-hidden="true" className="shrink-0" />
        {hasDevices && (
          <span
            className={cn(
              'border-background absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full border',
              anyOnline ? 'bg-emerald-500' : 'bg-amber-500',
            )}
          />
        )}
      </span>
    </button>
  )
}
