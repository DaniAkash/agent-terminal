import { useStore } from '@nanostores/react'
import { cn } from '@/lib/utils'
import { isLinux } from '@/modules/platform'
import { $sidebarView } from '@/modules/stores/$sidebarView'
import { $sidebarVisible } from '@/modules/stores/$sidebarVisible'
import { SidebarRecent } from './SidebarRecent'
import { SidebarResizeHandle } from './SidebarResizeHandle'
import { SidebarViewToggle } from './SidebarViewToggle'
import { SidebarWorkspaces } from './SidebarWorkspaces'

/* ---------------------------------------------------------------------------
 * Sidebar — thin composer.
 *
 * Renders the sidebar chrome (drag-region header, view toggle,
 * scroll-clip container with bottom shadow) and swaps the body between
 * SidebarWorkspaces / SidebarRecent based on `$sidebarView`.
 *
 * Returns `null` when `$sidebarVisible` is false — the sidebar is
 * fully hidden, not a minified icon rail. The reveal affordance
 * lives in the TabBar (`SidebarRevealButton`) so the user always has
 * a way back regardless of state.
 * -------------------------------------------------------------------------*/

export function Sidebar() {
  const visible = useStore($sidebarVisible)
  const view = useStore($sidebarView)

  if (!visible) return null

  return (
    <div className="border-sidebar-border bg-sidebar relative flex h-full w-[var(--sidebar-width)] min-w-[var(--sidebar-width)] flex-col border-r">
      {/* Center within the resizable Linux sidebar. Other platforms retain
          the reserved space for their existing title-bar controls. */}
      <div
        data-tauri-drag-region
        className={cn(
          'border-sidebar-border flex h-[38px] shrink-0 items-center border-b',
          isLinux ? 'justify-center px-3' : 'justify-end pr-3 pl-[80px]',
        )}
      >
        <SidebarViewToggle />
      </div>

      {/* Body — scrolls vertically; scrollbar hidden, bottom shadow
          gives a visual cue when more content exists below. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="h-full [scrollbar-width:none] overflow-y-auto py-1.5 [&::-webkit-scrollbar]:hidden">
          {view === 'workspaces' ? <SidebarWorkspaces /> : <SidebarRecent />}
        </div>

        {/* Bottom shadow — signals overflowing content */}
        <div
          className="pointer-events-none absolute right-0 bottom-0 left-0 h-8"
          style={{
            background:
              'linear-gradient(to top, var(--color-sidebar) 20%, transparent)',
          }}
        />
      </div>

      <SidebarResizeHandle />
    </div>
  )
}
