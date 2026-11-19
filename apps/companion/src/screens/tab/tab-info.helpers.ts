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

/** A tab the phone can move to when its own was closed. */
export interface OtherTab {
  projectId: string
  /** Composed wire id. */
  tabId: string
  label: string
  projectName: string
}

/** The name a screen last saw its tab under, keyed by tab. */
export interface SeenTab {
  tab: string
  label: string
}

/**
 * Remember the tab's current name, or keep the remembered one when the
 * tree no longer has the tab. Returns the same object when nothing
 * changed, so a caller holding it in state does not re-render for it.
 */
export function rememberTab(
  seen: SeenTab | null,
  tab: string,
  label: string | null,
): SeenTab | null {
  if (label === null) return seen?.tab === tab ? seen : null
  if (seen?.tab === tab && seen.label === label) return seen
  return { tab, label }
}

/**
 * Whether the desktop closed the tab on screen: the tree, as this
 * connection last sent it, no longer has a tab this screen has seen in
 * it. "Seen" matters: a tab the phone just created is briefly missing
 * from a tree sent a moment earlier, and is not closed.
 */
export function tabClosedOnDesktop(input: {
  connected: boolean
  projectsLoaded: boolean
  present: boolean
  seen: boolean
}): boolean {
  return input.connected && input.projectsLoaded && input.seen && !input.present
}

/**
 * The tabs still open on the desktop, the closed tab's own workspace
 * first, in the order the tree lists them.
 */
export function remainingTabs(
  projects: readonly ProjectSummary[],
  projectId: string,
  closedTabId: string,
): OtherTab[] {
  const ordered = [
    ...projects.filter((p) => p.project_id === projectId),
    ...projects.filter((p) => p.project_id !== projectId),
  ]
  return ordered.flatMap((project) =>
    project.tabs
      .filter((tab) => tab.tab_id !== closedTabId)
      .map((tab) => ({
        projectId: project.project_id,
        tabId: tab.tab_id,
        label: sessionLabel(tab),
        projectName: project.name,
      })),
  )
}
