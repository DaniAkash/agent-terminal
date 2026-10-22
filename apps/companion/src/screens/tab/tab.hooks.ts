import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'
import { $session } from '@/modules/stores/$session'
import { flushedWritesFor, sendBumpRecency } from '@/modules/wss/client'
import {
  INITIAL_NOTICE_STATE,
  type NoticeState,
  nextNotice,
  renderNotice,
} from './connection-notice.helpers'
import { splitTabId } from './tab.helpers'
import {
  type ActiveTabInfo,
  activeTabInfo,
  activeTabSummary,
} from './tab-info.helpers'
import { doneExpiresAt } from './tab-status.helpers'

/**
 * Name and state of the session on screen.
 *
 * `now` is state rather than a bare `Date.now()` so the done dot can
 * actually go out: the desktop stops sending frames once a turn ends and
 * `agent_state` stays "done" forever after, so nothing else would prompt
 * the re-render that dims it.
 */
export function useActiveTabInfo(
  projectId: string,
  composedTabId: string,
): ActiveTabInfo {
  const session = useStore($session)
  const [now, setNow] = useState(() => Date.now())

  const info = activeTabInfo(session.projects, projectId, composedTabId, now)
  const expiresAt = doneExpiresAt(
    activeTabSummary(session.projects, projectId, composedTabId),
  )

  // useEffect exception: a timer tied to a value, one of the cases
  // CLAUDE.md keeps the hook for. One timeout, armed only while a dot is
  // lit and waiting to expire.
  useEffect(() => {
    if (expiresAt === null) return
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) return
    const id = setTimeout(() => setNow(Date.now()), remaining)
    return () => clearTimeout(id)
  }, [expiresAt])

  return info
}

/**
 * Tell the desktop this session was just worked in, so its sidebar and
 * command palette rank it the way the phone does. Fire and forget: a
 * failed bump costs ordering, never the session.
 */
export function useNoteRecency(composedTabId: string): void {
  // useEffect exception: pushes to an external system (the desktop) on a
  // value change, with no render-time equivalent.
  useEffect(() => {
    const parts = splitTabId(composedTabId)
    if (!parts) return
    sendBumpRecency({
      project_id: parts.projectId,
      tab_id: composedTabId,
    }).catch(() => {})
  }, [composedTabId])
}

/**
 * Narrate connection changes into the terminal itself.
 *
 * A banner would cost permanent chrome on the one screen that cannot spare
 * it, and a modal would interrupt reading. The scrollback is where the user
 * is already looking, and the desktop's snapshot overwrites these lines on
 * resume, so they clean themselves up.
 */
export function useConnectionNotices(
  tabId: string,
  write: (payload: string) => void,
): void {
  const session = useStore($session)
  const noticeState = useRef<NoticeState>(INITIAL_NOTICE_STATE)

  // useEffect exception: pushes to an external system (the terminal
  // surface) on a value change, with no render-time equivalent, and it must
  // happen once per transition rather than once per render.
  useEffect(() => {
    const { state, notice } = nextNotice(
      noticeState.current,
      session.status,
      flushedWritesFor(tabId),
    )
    noticeState.current = state
    if (notice) write(renderNotice(notice))
  }, [session.status, tabId, write])
}
