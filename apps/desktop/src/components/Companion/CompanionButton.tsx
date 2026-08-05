import { Smartphone } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { openCompanionDialog } from './companion.data'

/**
 * StatusBar entry point to the Companion dialog. Sits next to
 * <ThemeToggle> in StatusBarLeft. Styling mirrors ThemeToggle's
 * ghost-sm button shape so both controls line up visually without
 * pulling in a shared layout wrapper.
 */
export function CompanionButton() {
  return (
    <button
      type="button"
      onClick={() => {
        void openCompanionDialog()
      }}
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'sm' }),
        'group gap-1.5 px-2.5 font-medium text-[11px] text-muted-foreground',
      )}
      style={{ fontFamily: 'var(--font-ui)' }}
      aria-label="Companion pairing"
      title="Pair a mobile device"
    >
      <Smartphone size={14} aria-hidden="true" className="shrink-0" />
    </button>
  )
}
