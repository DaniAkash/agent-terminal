/**
 * What the terminal's scrollback says when the connection changes under it.
 *
 * One line when an outage starts and one when it ends. The live state
 * (reconnecting, unreachable, how many keystrokes wait) is the banner's
 * job; the scrollback only keeps a record of the outage, and the
 * desktop's own snapshot overwrites these lines when the session resumes.
 */
export type ConnectionNotice = {
  text: string
  /** Dim for routine transitions, red for a connection that gave up. */
  tone: 'dim' | 'alarm'
}

const DIM = '\u001b[2m'
const RED = '\u001b[31m'
const RESET = '\u001b[0m'

/** Wrap a notice in the escape codes xterm needs, on its own line. */
export function renderNotice(notice: ConnectionNotice): string {
  const colour = notice.tone === 'alarm' ? RED : DIM
  return `\r\n${colour}${notice.text}${RESET}\r\n`
}

/**
 * What has been said so far, so an outage is narrated once rather than once
 * per retry.
 */
export interface NoticeState {
  /** Last status seen, or null before the first observation. */
  last: string | null
  /** True once this outage has been announced, cleared on reconnect. */
  warned: boolean
}

export const INITIAL_NOTICE_STATE: NoticeState = { last: null, warned: false }

/**
 * Advance the narration for a new status.
 *
 * Only transitions speak, and an outage speaks once: "connection lost"
 * when a working connection drops, then nothing while the resolver ladder
 * cycles `connecting` and `unreachable`, then "reconnected" when it is
 * back. Unreachable and refused have no line of their own any more: the
 * banner and the Removed screen say those.
 *
 * The first status seen is silent too: arriving at a working terminal
 * should not announce "reconnected" at someone who never left.
 */
export function nextNotice(
  state: NoticeState,
  next: string,
  queued: number,
): { state: NoticeState; notice: ConnectionNotice | null } {
  const { last, warned } = state
  if (last === null) return { state: { last: next, warned }, notice: null }
  if (last === next) return { state, notice: null }

  if (next === 'connected') {
    const notice: ConnectionNotice | null = warned
      ? {
          text:
            queued > 0
              ? `reconnected, sent ${queued} queued keystrokes`
              : 'reconnected',
          tone: 'dim',
        }
      : null
    return { state: { last: next, warned: false }, notice }
  }

  if (last === 'connected' && !warned) {
    return {
      state: { last: next, warned: true },
      notice: { text: 'connection lost, keystrokes are queued', tone: 'dim' },
    }
  }
  return { state: { last: next, warned }, notice: null }
}
