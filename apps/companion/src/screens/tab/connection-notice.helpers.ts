/**
 * What the terminal should say when the connection changes under it.
 *
 * Printed into the scrollback rather than shown as a banner: the user is
 * already looking there, and permanent chrome is the one thing this screen
 * cannot afford. The desktop's own snapshot overwrites these lines when the
 * session resumes, so they clean themselves up.
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
 * Only transitions speak, and an outage speaks once. The resolver ladder
 * cycles `connecting` and `unreachable` while it retries, so keying purely
 * off "the status changed" prints the same warning on every attempt and
 * buries the scrollback the user was trying to read.
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

  const moved: NoticeState = { last: next, warned }

  if (next === 'connected') {
    const notice: ConnectionNotice | null = warned
      ? {
          text:
            queued > 0
              ? `reconnected, sending ${queued} queued keystrokes`
              : 'reconnected',
          tone: 'dim',
        }
      : null
    return { state: { last: next, warned: false }, notice }
  }

  if (warned) return { state: moved, notice: null }

  if (next === 'unreachable') {
    return {
      state: { last: next, warned: true },
      notice: { text: 'desktop unreachable, still retrying', tone: 'alarm' },
    }
  }
  if (next === 'auth_failed') {
    return {
      state: { last: next, warned: true },
      notice: { text: 'desktop refused this device', tone: 'alarm' },
    }
  }
  if (last === 'connected') {
    return {
      state: { last: next, warned: true },
      notice: {
        text: 'connection lost, keystrokes will be queued',
        tone: 'dim',
      },
    }
  }
  return { state: moved, notice: null }
}
