import type { TabVisual } from '../agent/agent.types'

/**
 * One session, in the shape both apps can produce and neither has to
 * think about.
 *
 * The desktop holds a project tree, a separate `$tabMeta` map and a
 * recency store; the phone holds one `ProjectSummary[]` with recency
 * baked into each tab. Those are different enough that sharing the
 * ordering means agreeing on a middle shape first. This is it, and each
 * app writes one small adapter to reach it.
 *
 * Everything here is already resolved. `label` has been through
 * `resolveTabLabel`, `visual` through `deriveTabVisual`. A consumer
 * orders and groups these; it never re-decides what one says.
 */
export interface SessionNode {
  /** Composed `projectId:tabId`, unique across workspaces. */
  key: string
  projectId: string
  projectName: string
  projectPinned: boolean
  projectExpanded: boolean
  /** Raw id with the project prefix off, which is what routes want. */
  tabId: string
  label: string
  pinned: boolean
  /** Epoch ms, or absent for a session never opened in the tracked window. */
  lastActiveAt?: number | undefined
  isCurrent: boolean
  visual: TabVisual
}

/** A session in a flat, recency-ordered list. */
export interface SessionRow extends SessionNode {
  /**
   * 1-based position in recency order, uncapped. Zero means the session
   * has never been opened in the tracked window.
   */
  rank: number
}

/** One workspace and the sessions under it, in display order. */
export interface WorkspaceGroup {
  projectId: string
  projectName: string
  pinned: boolean
  expanded: boolean
  /** 1-based display position, which the desktop also uses for Cmd+N. */
  position: number
  sessions: SessionNode[]
}

/** Which half of the sidebar, or of the sheet, is on show. */
export type SessionView = 'workspaces' | 'recent'

/** Storage key for the chosen view, so both apps remember the same thing. */
export const SESSION_VIEW_KEY = 'agent-terminal:sidebar-view'

export function isSessionView(value: unknown): value is SessionView {
  return value === 'workspaces' || value === 'recent'
}
