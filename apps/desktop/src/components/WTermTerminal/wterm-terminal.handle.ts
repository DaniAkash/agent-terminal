import type { WTerm } from '@wterm/dom'
import { $activeSearch } from '@/modules/stores/$activeSearch'

export type WTermHandle = {
  write: (data: string) => void
  focus: () => void
  /**
   * Re-measure the pane and resize the grid to match.
   *
   * wterm sizes itself from a ResizeObserver, and an inactive pane is
   * `display: none`, so it has no box and reports nothing. A pane that
   * was hidden while the window changed size therefore keeps the grid it
   * had, which is what leaves a session sitting in a corner of its pane.
   */
  fit: () => void
  /**
   * The grid the terminal currently has, or null before it has booted.
   *
   * The PTY is spawned after the terminal has already measured itself, and
   * a resize that arrives before it exists is dropped, so the caller has to
   * re-assert the size once the PTY is there.
   */
  getSize: () => { cols: number; rows: number } | null
  /** Clears the visible buffer and the scrollback. */
  clear: () => void
  /** Selects all text in the buffer. */
  selectAll: () => void
  /**
   * Jumps to the next match for the current `$activeSearch` query.
   *
   * `incremental` exists so a typing-driven call can leave the highlight
   * on the match it is already sitting on while that match still
   * satisfies the growing query, instead of advancing past it.
   */
  searchNext: (opts?: { incremental?: boolean }) => void
  /** Jumps to the previous match for the current `$activeSearch` query. */
  searchPrevious: () => void
  /**
   * Writes data into the PTY as if the user typed it. Goes through the
   * same channel wterm uses for keypresses, so it ends up at
   * `IPC.writePty(tabKey, data)` via TerminalPane's `handleData`. Raw,
   * no transformation. Use for flows that genuinely simulate typing.
   */
  sendToPty: (data: string) => void
  /**
   * Writes data as a paste. If the running app has enabled bracketed
   * paste mode (DECSET 2004, which Claude Code, Codex and modern shells
   * all do), wraps the payload so the app can tell paste from typing.
   * Without that, agents render a dropped file path as plain text
   * instead of attaching it.
   *
   * If bracketed paste is off, sends unwrapped, because the markers
   * would otherwise show up as visible escape garbage.
   */
  pasteToPty: (data: string) => void
}

/** Erase the screen, erase the scrollback, home the cursor. */
const CLEAR_SEQUENCE = '\x1b[2J\x1b[3J\x1b[H'

/**
 * Run the active query, unless it is already the one loaded.
 *
 * `search()` restarts from the top, so re-running it for an incremental
 * keystroke would drop the caller back to the first match. Returns false
 * when there is nothing to search, having cleared any stale highlight.
 */
function syncQuery(term: WTerm): boolean {
  const search = $activeSearch.get()
  if (!search?.query) {
    term.clearSearch()
    return false
  }
  if (term.getSearchState().query !== search.query) {
    term.search(search.query, { caseSensitive: search.matchCase })
    return true
  }
  return false
}

/**
 * The imperative surface `TerminalPane` drives, over whichever terminal
 * `getTerm` currently holds.
 *
 * Built against a getter rather than a terminal because the component
 * constructs its terminal asynchronously and replaces it on remount, so
 * a captured instance would go stale.
 */
export function createWTermHandle(opts: {
  getTerm: () => WTerm | null
  sendData: (data: string) => void
}): WTermHandle {
  const { getTerm, sendData } = opts
  return {
    write: (data) => getTerm()?.write(data),
    focus: () => getTerm()?.focus(),
    fit: () => getTerm()?.fit(),
    getSize: () => {
      const term = getTerm()
      return term ? { cols: term.cols, rows: term.rows } : null
    },
    clear: () => getTerm()?.write(CLEAR_SEQUENCE),
    selectAll: () => {
      void getTerm()?.selectAll()
    },
    searchNext: (handleOpts) => {
      const term = getTerm()
      if (!term) return
      const restarted = syncQuery(term)
      if (restarted && handleOpts?.incremental) return
      if ($activeSearch.get()?.query) term.findNext()
    },
    searchPrevious: () => {
      const term = getTerm()
      if (!term) return
      syncQuery(term)
      if ($activeSearch.get()?.query) term.findPrevious()
    },
    sendToPty: (data) => sendData(data),
    pasteToPty: (data) => {
      const bracketed = getTerm()?.bridge?.bracketedPaste() ?? false
      sendData(bracketed ? `\x1b[200~${data}\x1b[201~` : data)
    },
  }
}
