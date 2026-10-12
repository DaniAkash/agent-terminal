import type {
  ProjectSummary,
  TabStateSummary,
} from '@/modules/wss/protocol.gen'
import { relativeAge } from '@/screens/switcher/switcher.helpers'
import {
  glyphLabel,
  type TabGlyph,
  tabGlyph,
} from '@/screens/tab/tab-status.helpers'

export interface StatusField {
  label: string
  value: string
  mono: boolean
}

export interface SessionStatus {
  label: string
  glyph: TabGlyph
  /** "running", "needs you", and so on, plus how long it has been that way. */
  state: string
  fields: StatusField[]
}

/** Shown when a field has nothing behind it, rather than an empty row. */
export const UNSET = 'not set'

/**
 * Everything the status sheet shows, derived in one pure place.
 *
 * Only what the wire actually carries appears here. The desktop status bar
 * reports more than this protocol does, and inventing the rest would make
 * the sheet look complete while being wrong.
 *
 * `tab_state` is preferred over the tree where both have a field: the tree
 * is a periodic snapshot, while `tab_state` is pushed when it changes.
 */
export function sessionStatus(
  project: ProjectSummary | undefined,
  tabId: string,
  state: TabStateSummary | undefined,
  now: number,
): SessionStatus | null {
  const tab = project?.tabs.find((t) => t.tab_id === tabId)
  if (!tab) return null

  const glyph = tabGlyph(tab.agent_state, tab.agent_state_at, now)
  const since = relativeAge(tab.agent_state_at, now)
  const ports = state?.ports ?? []

  return {
    label: tab.label,
    glyph,
    state: since ? `${glyphLabel(glyph)} · ${since}` : glyphLabel(glyph),
    fields: [
      field('Workspace', project?.name),
      field('Directory', state?.cwd ?? tab.last_cwd ?? tab.cwd, true),
      field('Agent', state?.agent ?? tab.agent),
      field('Branch', state?.git_branch, true),
      field('Ports', ports.length > 0 ? ports.join(', ') : undefined, true),
      field('Running', tab.is_spawned ? 'yes' : 'no, sleeping'),
    ],
  }
}

function field(label: string, value?: string, mono = false): StatusField {
  return { label, value: value && value.length > 0 ? value : UNSET, mono }
}
