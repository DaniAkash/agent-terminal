/**
 * Composes the PTY tab id from a project id and a per-project tab id.
 *
 * IMPORTANT: this MUST match the Rust `compose_tab_id` in
 * `src-tauri/src/projects_cache.rs` byte for byte. Rust runs the same
 * formula when handing `TabSummary.tab_id` to the companion, so a drift
 * here silently produces two PtyMap entries for the "same" tab and the
 * two devices stop sharing a shell. Both sides are pinned by tests.
 */
export function makeTabKey(projectId: string, tabId: string): string {
  return `${projectId}:${tabId}`
}

/** The raw tab id, with the project prefix taken back off. */
export function rawTabId(projectId: string, composed: string): string {
  const prefix = `${projectId}:`
  return composed.startsWith(prefix) ? composed.slice(prefix.length) : composed
}

/**
 * Last path segment of a working directory, with a leading slash.
 *
 *   "/Users/you/code/agent-terminal" → "/agent-terminal"
 *   "/"                              → "/"
 */
export function cwdBasename(cwd: string): string {
  const trimmed = cwd.replace(/\/$/, '')
  const slash = trimmed.lastIndexOf('/')
  const last = trimmed.slice(slash + 1)
  return last ? `/${last}` : '/'
}

/**
 * The name to show for a session.
 *
 * A name the user typed is always kept. Otherwise the directory stands in
 * for it, so an unnamed session reads as where it is rather than as the
 * order it happened to be created in, and it follows the shell as the
 * user moves around. The stored label is the fallback for a session whose
 * directory is not known yet, which is what a tree loaded from disk looks
 * like before the first shell-integration event.
 *
 * This lived in both apps, byte for byte, under comments in each asking
 * the other to stay in step. A session shown as `/control-center` on the
 * desktop and `shell 2` on the phone is the same session, and anyone
 * looking at both has to work that out for themselves.
 */
export function resolveTabLabel(
  tab: { label: string; userRenamed?: boolean | undefined },
  cwd: string | undefined,
): string {
  if (tab.userRenamed) return tab.label
  if (cwd) return cwdBasename(cwd)
  return tab.label
}
