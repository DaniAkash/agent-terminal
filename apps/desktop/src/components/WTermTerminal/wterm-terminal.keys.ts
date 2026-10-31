// Keyboard helpers for `WTermTerminal`. Split out of the component file so
// the mount-once effect stays simple and the file lengths stay sane.

/**
 * Returns true when the key combo is claimed by the app's hotkey layer
 * (react-hotkeys-hook at document level).
 *
 * Order in `handleKeyEvent` is load-bearing: line-edit and agent-newline
 * translations are checked BEFORE this. So by the time we get here,
 * the meta-key combos with PTY translations (`⌘←`, `⌘→`, `⌘⌫`) have
 * already been handled — anything Cmd-based reaching this filter is
 * an app shortcut bound at the react-hotkeys-hook layer (`⌘T`, `⌘W`,
 * `⌘K`, `⌘F`, `⌘1..9`, …). Bubbling all remaining meta-key combos is
 * safe and removes the per-shortcut allowlist that grew with the keymap.
 *
 * Ctrl+Tab / Ctrl+Shift+Tab are the only Ctrl-based aliases: they back
 * the Cmd+Shift+] / Cmd+Shift+[ tab-nav muscle memory from Apple
 * Terminal, VS Code, Chrome. Safe on Ctrl because Ctrl+Tab has no
 * readline binding (Tab itself is shell-bound but Ctrl+Tab isn't).
 *
 * Browser-level shortcuts (Cmd+C/V copy/paste) are handled by the
 * webview before the terminal sees them and are unaffected by this
 * filter.
 */
function isAppShortcut(e: KeyboardEvent): boolean {
  if (e.metaKey) return true
  if (e.ctrlKey && e.key === 'Tab') return true
  return false
}

/**
 * Translates macOS line-editing chords (⌥←, ⌘←, ⌥⌫, etc.) into the
 * readline byte sequences the shell already understands. Mirrors what
 * Apple Terminal / iTerm2 / Ghostty / Warp do at the terminal layer.
 *
 * Returns the bytes to write to the PTY, or `null` if the event isn't
 * a translatable chord. The caller writes the bytes via `onData` and
 * suppresses the terminal's own default, whose "modified arrow" CSI
 * sequence (`\x1b[1;3D` and friends) reaches readline as gibberish.
 *
 * Byte mappings (keyed by `<modifier>:<key>`):
 *   alt:ArrowLeft   `\x1bb` = ESC + 'b' = Meta-B = `backward-word`
 *   alt:ArrowRight  `\x1bf` = ESC + 'f' = Meta-F = `forward-word`
 *   alt:Backspace   `\x17`  = Ctrl+W           = `backward-kill-word`
 *   meta:ArrowLeft  `\x01`  = Ctrl+A           = `beginning-of-line`
 *   meta:ArrowRight `\x05`  = Ctrl+E           = `end-of-line`
 *   meta:Backspace  `\x15`  = Ctrl+U           = `unix-line-discard`
 */
const LINE_EDIT_MAP: Record<string, string> = {
  'alt:ArrowLeft': '\x1bb',
  'alt:ArrowRight': '\x1bf',
  'alt:Backspace': '\x17',
  'meta:ArrowLeft': '\x01',
  'meta:ArrowRight': '\x05',
  'meta:Backspace': '\x15',
}

function translateLineEdit(e: KeyboardEvent): string | null {
  // Strict modifier match — exactly one of alt/meta and none of the
  // others. Broader chords (Cmd+Shift+Left, etc.) stay free for future
  // bindings rather than getting silently translated.
  const onlyAlt = e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey
  const onlyMeta = e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey
  const mod = onlyAlt ? 'alt' : onlyMeta ? 'meta' : null
  if (mod === null) return null
  return LINE_EDIT_MAP[`${mod}:${e.key}`] ?? null
}

/**
 * Translates Shift+Enter / Option+Enter into the Meta-Enter byte
 * sequence (`\x1b\r`) that Ink-based AI-agent input boxes (Claude
 * Code, Codex) recognize as "insert newline, don't submit". Only fires
 * when the pane is running an agent — outside agent tabs the same
 * keypresses pass through unchanged so a plain shell still treats
 * Shift+Enter as Enter.
 *
 * Cmd+Enter is intentionally NOT bound — Slack/Linear/ChatGPT all
 * reserve it for "submit"; reusing it for newline would surprise users
 * coming from those apps.
 */
function translateAgentNewline(
  e: KeyboardEvent,
  isAgent: boolean,
): string | null {
  if (!isAgent) return null
  if (e.key !== 'Enter') return null
  const onlyShift = e.shiftKey && !e.metaKey && !e.altKey && !e.ctrlKey
  const onlyAlt = e.altKey && !e.metaKey && !e.shiftKey && !e.ctrlKey
  if (onlyShift || onlyAlt) return '\x1b\r'
  return null
}

export type HandleKeyEventOpts = {
  isAgent: boolean
  onData: (data: string) => void
}

/**
 * Returns the byte sequence this event translates to, if any. Pure —
 * safe to call multiple times for the same event without side effects.
 */
function matchTranslation(e: KeyboardEvent, isAgent: boolean): string | null {
  return translateAgentNewline(e, isAgent) ?? translateLineEdit(e)
}

/**
 * What the host should do with a key event.
 *
 * `terminal` lets wterm handle it. The other two both mean wterm must
 * not see it, and they are distinguished because they diverge after
 * that: a translation is finished business, while an app shortcut still
 * has to reach the document so react-hotkeys-hook can run it.
 */
export type KeyVerdict = 'terminal' | 'translated' | 'app-shortcut'

/**
 * Single dispatch point for the host's capture-phase keydown listener.
 *
 * Order matters. Translations win over app-shortcut bubbling because
 * some translations (Cmd+arrow) would otherwise be eaten by
 * `isAppShortcut` returning true for any meta-key combo.
 *
 * The side-effecting write fires only on keydown, so one physical
 * keypress sends the translated bytes exactly once, while the verdict
 * itself is returned for every event flavour so the caller can keep
 * suppressing wterm across the whole keydown/keyup lifecycle.
 */
export function classifyKeyEvent(
  e: KeyboardEvent,
  opts: HandleKeyEventOpts,
): KeyVerdict {
  const translation = matchTranslation(e, opts.isAgent)
  if (translation !== null) {
    if (e.type === 'keydown') opts.onData(translation)
    return 'translated'
  }
  if (isAppShortcut(e)) return 'app-shortcut'
  return 'terminal'
}
