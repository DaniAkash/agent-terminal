import { useStore } from '@nanostores/react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  $sidebarVisible,
  toggleSidebarVisible,
} from '@/modules/stores/$sidebarVisible'

/* ---------------------------------------------------------------------------
 * SidebarRevealButton — always-visible sidebar toggle in the TabBar.
 *
 * Rendered as the leftmost child of the TabBar so it stays reachable
 * regardless of sidebar state:
 *   - hidden  → click to reveal ("open panel" icon)
 *   - visible → click to hide   ("close panel" icon)
 *
 * The equivalent global hotkey is ⌘B, wired in WorkspaceLayout. Both
 * paths call `toggleSidebarVisible` so behavior stays in one place.
 * -------------------------------------------------------------------------*/

export function SidebarRevealButton() {
  const visible = useStore($sidebarVisible)
  const label = visible ? 'Hide sidebar' : 'Show sidebar'
  const Icon = visible ? PanelLeftClose : PanelLeftOpen
  return (
    <TooltipProvider delay={400}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={label}
              aria-pressed={visible}
              onClick={toggleSidebarVisible}
              // Opt this button out of the parent TabBar's tauri drag region
              // so clicks toggle instead of moving the window.
              data-tauri-drag-region={undefined}
              className="-mb-px flex h-7 w-7 shrink-0 items-center justify-center rounded text-tab-fg hover:bg-sidebar-hover hover:text-tab-fg-active"
            >
              <Icon size={14} />
            </button>
          }
        />
        <TooltipContent side="bottom" sideOffset={4}>
          {label} (⌘B)
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
