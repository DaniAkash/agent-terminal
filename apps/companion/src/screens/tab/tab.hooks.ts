import { useStore } from '@nanostores/react'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { $recency } from '@/modules/stores/$recency'
import { $session } from '@/modules/stores/$session'
import { queuedWritesFor, sendBumpRecency } from '@/modules/wss/client'
import {
  INITIAL_NOTICE_STATE,
  type NoticeState,
  nextNotice,
  renderNotice,
} from './connection-notice.helpers'
import { rawTabId, splitTabId } from './tab.helpers'
import {
  type ActiveTabInfo,
  activeStateStamp,
  activeTabInfo,
} from './tab-info.helpers'
import { doneExpiresAt } from './tab-status.helpers'
import {
  advanceSwipe,
  type SwipeDirection,
  type SwipeState,
} from './tab-swipe.helpers'

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
  const stamp = activeStateStamp(session.projects, projectId, composedTabId)
  const expiresAt = doneExpiresAt(stamp.state, stamp.at)

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
 * Step through session history with a horizontal swipe.
 *
 * Navigation is `setParams`, not `replace`: the route stays the same
 * instance, so the terminal's webview is never torn down and switching
 * costs a stream resubscribe rather than a reload. The URL still changes,
 * so a session reached by swiping is as deep linkable as one reached by
 * tapping.
 */
export function useSessionSwipe(composedTabId: string) {
  const router = useRouter()
  const order = useStore($recency)
  const runRef = useRef<SwipeState | null>(null)

  const step = useCallback(
    (direction: SwipeDirection) => {
      const keys = order.map((entry) => entry.key)
      const out = advanceSwipe(
        runRef.current,
        direction,
        keys,
        composedTabId,
        Date.now(),
        new Set(keys),
      )
      if (!out) return
      runRef.current = out.state
      const parts = splitTabId(out.target)
      if (!parts) return
      router.setParams({
        projectId: parts.projectId,
        tabId: rawTabId(parts.projectId, out.target),
      })
    },
    [order, composedTabId, router],
  )

  return {
    swipeBack: useCallback(() => step(1), [step]),
    swipeForward: useCallback(() => step(-1), [step]),
  }
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
      queuedWritesFor(tabId),
    )
    noticeState.current = state
    if (notice) write(renderNotice(notice))
  }, [session.status, tabId, write])
}
