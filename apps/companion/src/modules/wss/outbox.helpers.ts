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

/**
 * Upper bound on queued input, counted in string length.
 *
 * The write cap bounds entries, not input: `data` is whatever the terminal
 * handed over, and a paste arrives as one entry of any size. Length is
 * counted rather than UTF-8 bytes because the queue holds JS strings, so
 * it is the memory actually at stake. 64k is far more than a reconnect's
 * worth of typing.
 */
export const MAX_QUEUED_CHARS = 64 * 1024

export interface QueueLimits {
  maxWrites?: number
  maxChars?: number
}

export function enqueueWrite(
  queue: readonly QueuedWrite[],
  write: QueuedWrite,
  limits: QueueLimits = {},
): QueuedWrite[] {
  const maxWrites = limits.maxWrites ?? MAX_QUEUED_WRITES
  const maxChars = limits.maxChars ?? MAX_QUEUED_CHARS
  // A write too big to fit is refused outright instead of evicting the
  // whole queue to make room for itself. Something that large is a paste,
  // not keystrokes, and replaying it into a shell minutes later is worse
  // than never queuing it.
  if (write.data.length > maxChars) return [...queue]
  const next = [...queue, write]
  let chars = next.reduce((sum, w) => sum + w.data.length, 0)
  while (next.length > 1 && (next.length > maxWrites || chars > maxChars)) {
    const evicted = next.shift()
    chars -= evicted?.data.length ?? 0
  }
  return next
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

/** How many writes each session accounts for. */
export function tallyByTab(
  writes: readonly QueuedWrite[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const write of writes) {
    counts.set(write.tabId, (counts.get(write.tabId) ?? 0) + 1)
  }
  return counts
}
