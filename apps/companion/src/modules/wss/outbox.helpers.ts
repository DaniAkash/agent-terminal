/**
 * Keystrokes typed while the socket is down.
 *
 * Pure so the rules that make queuing safe can be tested without a socket:
 * what is kept, what is dropped, and above all where a queued keystroke is
 * allowed to land when the connection comes back.
 */

export interface QueuedWrite {
  tabId: string
  data: string
}

/**
 * Upper bound on queued keystrokes.
 *
 * Someone who keeps typing at a dead connection should not accumulate an
 * unbounded buffer that replays minutes of input at once when it returns.
 * Oldest goes first: the most recent keystrokes are the ones still
 * connected to what the user currently intends.
 */
export const MAX_QUEUED_WRITES = 256

export function enqueueWrite(
  queue: readonly QueuedWrite[],
  write: QueuedWrite,
  max: number = MAX_QUEUED_WRITES,
): QueuedWrite[] {
  const next = [...queue, write]
  return next.length <= max ? next : next.slice(next.length - max)
}

/**
 * Split a queue into what may be sent and what must not be.
 *
 * A queued keystroke may only land in the session it was typed into. If
 * that session is gone, or is no longer the one being streamed, the
 * keystroke is dropped rather than redirected: a half-typed `rm -rf` must
 * never arrive in a different shell than the one the user was looking at.
 * Dropping is the safe failure, replaying somewhere else is not.
 */
export function drainWrites(
  queue: readonly QueuedWrite[],
  isStillSubscribed: (tabId: string) => boolean,
): { flush: QueuedWrite[]; dropped: QueuedWrite[] } {
  const flush: QueuedWrite[] = []
  const dropped: QueuedWrite[] = []
  for (const write of queue) {
    if (isStillSubscribed(write.tabId)) flush.push(write)
    else dropped.push(write)
  }
  return { flush, dropped }
}

/** How many keystrokes are waiting for a given session. */
export function queuedFor(
  queue: readonly QueuedWrite[],
  tabId: string,
): number {
  return queue.filter((w) => w.tabId === tabId).length
}
