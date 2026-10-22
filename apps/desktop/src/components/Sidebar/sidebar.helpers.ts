import {
  deriveTabVisual,
  makeTabKey,
  resolveTabLabel,
  type SessionNode,
} from '@agent-terminal/core-ui'
import { tabVisualInput } from '@/components/agent.helpers'
import type { TabMeta } from '@/modules/stores/$tabMeta'
import type { Project } from '@/screens/workspace/workspace.types'

/**
 * The desktop's adapter onto the shared session model.
 *
 * Three stores hold what one `SessionNode` carries: `$projects` has the
 * tree, `$tabMeta` the runtime state, `$tabRecencyTimes` the stamps.
 * Flattening them here means every ordering and grouping rule above this
 * line is the same code the phone runs, and the only thing that differs
 * between the two apps is where the data was kept.
 */
export function toSessionNodes(args: {
  projects: Project[]
  tabMeta: Record<string, TabMeta>
  recencyTimes: Record<string, number>
  activeProjectId: string
  activeTabIds: Record<string, string>
  now: number
}): SessionNode[] {
  const activeTabId = args.activeTabIds[args.activeProjectId]
  const activeKey = activeTabId
    ? makeTabKey(args.activeProjectId, activeTabId)
    : ''

  const nodes: SessionNode[] = []
  for (const project of args.projects) {
    for (const tab of project.tabs) {
      const key = makeTabKey(project.id, tab.id)
      const meta = args.tabMeta[key]
      const isCurrent = key === activeKey
      nodes.push({
        key,
        projectId: project.id,
        projectName: project.name,
        projectPinned: project.pinned,
        // undefined pre-dates the field, and those projects were expanded.
        projectExpanded: project.isExpanded !== false,
        tabId: tab.id,
        // Resolved here so every surface shows one string for one tab.
        label: resolveTabLabel(tab, meta?.cwd),
        pinned: tab.pinned,
        lastActiveAt: args.recencyTimes[key],
        isCurrent,
        visual: deriveTabVisual(tabVisualInput(meta, isCurrent), args.now),
      })
    }
  }
  return nodes
}
