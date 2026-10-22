import type { TabVisual } from '@agent-terminal/core-ui'
import type { ProjectSummary, TabSummary } from '@/modules/wss/protocol.gen'
import { splitTabId } from './tab.helpers'
import { sessionLabel } from './tab-label.helpers'
import { tabVisualFor } from './tab-status.helpers'

export interface ActiveTabInfo {
  label: string
  projectName: string
  visual: TabVisual
}

/**
 * What the session bar shows, derived from the tree the switcher also
 * reads so the two can never disagree.
 *
 * Every field degrades rather than disappearing. A tab the tree has not
 * caught up with still gets a name from its own id, because a bar that
 * blanks out mid-switch reads as a bug even when nothing is wrong.
 */
export function activeTabInfo(
  projects: readonly ProjectSummary[],
  projectId: string,
  composedTabId: string,
  now: number,
): ActiveTabInfo {
  const project = projects.find((p) => p.project_id === projectId)
  const tab = project?.tabs.find((t) => t.tab_id === composedTabId)
  return {
    label: tab
      ? sessionLabel(tab)
      : (splitTabId(composedTabId)?.tabId ?? 'session'),
    projectName: project?.name ?? '',
    // active: this is the session on screen, so an idle agent mark shows
    // at full strength rather than dimmed the way a background row does.
    visual: tabVisualFor(tab, now, true),
  }
}

/** The tree's entry for the session on screen, if it has one yet. */
export function activeTabSummary(
  projects: readonly ProjectSummary[],
  projectId: string,
  composedTabId: string,
): TabSummary | undefined {
  const project = projects.find((p) => p.project_id === projectId)
  return project?.tabs.find((t) => t.tab_id === composedTabId)
}
