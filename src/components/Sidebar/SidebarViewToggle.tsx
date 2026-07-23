import { useStore } from '@nanostores/react'
import { cn } from '@/lib/utils'
import {
  $sidebarView,
  type SidebarView,
  setSidebarView,
} from '@/modules/stores/$sidebarView'

/* ---------------------------------------------------------------------------
 * SidebarViewToggle — segmented Workspaces / Recent switch.
 *
 * Two-option toggle rendered inline in the sidebar header. We don't reach
 * for shadcn Tabs here: adding a full Radix Tabs primitive for two
 * buttons that don't own their own panel content would be more code and
 * more indirection than the direct segmented control. The actual panel
 * swap is done by the Sidebar composer based on `$sidebarView`.
 * -------------------------------------------------------------------------*/

const OPTIONS: Array<{ value: SidebarView; label: string }> = [
  { value: 'workspaces', label: 'Workspaces' },
  { value: 'recent', label: 'Recent' },
]

export function SidebarViewToggle() {
  const current = useStore($sidebarView)
  return (
    <div className="flex h-[22px] items-center gap-0.5 rounded-md bg-sidebar-hover/40 p-0.5">
      {/* No ARIA grouping: each button is self-labelled ("Workspaces" /
          "Recent") and carries its own aria-pressed state, which is what
          a screen reader needs. Adding a group role would just repeat
          what the button names already say. */}
      {OPTIONS.map((opt) => {
        const active = current === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => setSidebarView(opt.value)}
            className={cn(
              'h-full flex-1 rounded-[4px] px-2 font-medium text-[10.5px] leading-none transition-colors',
              active
                ? 'bg-sidebar text-sidebar-fg-strong shadow-sm'
                : 'text-sidebar-fg opacity-70 hover:opacity-100',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
