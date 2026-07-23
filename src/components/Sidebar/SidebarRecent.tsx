import { useStore } from '@nanostores/react'
import { useMemo } from 'react'
import { TabChip } from '@/components/TabChip/TabChip'
import { buildSwitcherRows } from '@/components/TabSwitcher/tab-switcher.helpers'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  $activeProjectId,
  $activeTabId,
  navigateToTab,
} from '@/modules/stores/$navigation'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { $tabRecency, $tabRecencyTimes } from '@/modules/stores/$tabRecency'
import { MONO_FONT } from '@/screens/workspace/workspace.helpers'
import { toRecentSidebarRows } from './sidebar.helpers'

/* ---------------------------------------------------------------------------
 * SidebarRecent — flat recency list across every project.
 *
 * Same data source as the Cmd+P palette (`buildSwitcherRows`). The
 * palette optimizes for filtered search and shows rank / project /
 * cwd / relative time; the sidebar optimizes for at-a-glance recall
 * and shows only the tab label + TabChip, with the project name
 * available on hover via Tooltip.
 *
 * Rows never visited during the tracked window are filtered out
 * (`toRecentSidebarRows`), so this view stays useful when the project
 * tree is noisy across ten-plus projects.
 * -------------------------------------------------------------------------*/

export function SidebarRecent() {
  const projects = useStore($projects)
  const recency = useStore($tabRecency)
  const recencyTimes = useStore($tabRecencyTimes)
  const tabMeta = useStore($tabMeta)
  const activeProjectId = useStore($activeProjectId)
  const activeTabIds = useStore($activeTabId)

  const rows = useMemo(
    () =>
      toRecentSidebarRows(
        buildSwitcherRows({
          projects,
          recency,
          recencyTimes,
          tabMeta,
          activeProjectId,
          activeTabIds,
        }),
      ),
    [projects, recency, recencyTimes, tabMeta, activeProjectId, activeTabIds],
  )

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
        <p className="text-[12px] text-sidebar-fg opacity-60">
          No recent tabs yet.
        </p>
        <p className="text-[11px] text-sidebar-fg opacity-40">
          Switch between tabs to build up recency.
        </p>
      </div>
    )
  }

  return (
    <TooltipProvider delay={400}>
      {rows.map((row) => (
        <Tooltip key={row.tabKey}>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => {
                  if (!row.isCurrent) navigateToTab(row.projectId, row.tabId)
                }}
                className={cn(
                  'mx-1.5 flex h-[26px] w-[calc(100%-12px)] items-center gap-2 rounded-md px-3 text-left',
                  row.isCurrent
                    ? 'bg-sidebar-active text-sidebar-fg-strong'
                    : 'text-sidebar-fg hover:bg-sidebar-hover',
                )}
              >
                <span
                  className={cn(
                    'flex-1 truncate',
                    row.isCurrent && 'font-medium',
                  )}
                  style={{ fontFamily: MONO_FONT, fontSize: 11.5 }}
                >
                  {row.label}
                </span>
                <TabChip
                  tabId={row.tabKey}
                  density="compact"
                  active={row.isCurrent}
                />
              </button>
            }
          />
          <TooltipContent side="right" sideOffset={6}>
            {row.projectName}
          </TooltipContent>
        </Tooltip>
      ))}
    </TooltipProvider>
  )
}
