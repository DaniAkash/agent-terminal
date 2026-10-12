import type { ProjectSummary } from '@/modules/wss/protocol.gen'
import { splitTabId } from './tab.helpers'
import { sessionLabel } from './tab-label.helpers'
import { type TabGlyph, tabGlyph } from './tab-status.helpers'

export interface ActiveTabInfo {
  label: string
  projectName: string
  glyph: TabGlyph
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
    glyph: tabGlyph(tab?.agent_state, tab?.agent_state_at, now),
  }
}

/** The agent state stamp behind the current glyph, if the tree has one. */
export function activeStateStamp(
  projects: readonly ProjectSummary[],
  projectId: string,
  composedTabId: string,
): { state: string | undefined; at: number | undefined } {
  const project = projects.find((p) => p.project_id === projectId)
  const tab = project?.tabs.find((t) => t.tab_id === composedTabId)
  return { state: tab?.agent_state, at: tab?.agent_state_at }
}
