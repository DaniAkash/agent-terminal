export const MONO_FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace'

/**
 * Compose the PTY tab_id key from a project id + the raw per-project
 * tab id. The desktop uses this when opening a tab via `IPC.openTab`.
 *
 * IMPORTANT: this composition MUST match the Rust-side
 * `compose_tab_id` in `src-tauri/src/projects_cache.rs` byte-for-byte.
 * Rust runs the same formula when handing `TabSummary.tab_id` to the
 * mobile companion, so a drift here silently produces two separate
 * PtyMap entries per "same" tab and mobile / desktop stop sharing a
 * shell. Both sides are pinned by tests:
 *
 *   - Rust:    `compose_tab_id_matches_desktop_makeTabKey` in projects_cache.rs
 *   - Desktop: `workspace.helpers.test.ts` (this folder)
 *
 * If you edit this function, update the Rust helper AND both tests in
 * the same PR.
 */
export function makeTabKey(projectId: string, tabId: string): string {
  return `${projectId}:${tabId}`
}

export function dedupeLabel(existing: string[], base = 'shell'): string {
  let label = base
  let n = 2
  const set = new Set(existing)
  while (set.has(label)) label = `${base} ${n++}`
  return label
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function randomSuffix(): string {
  return Math.random().toString(16).slice(2, 6)
}

/**
 * Returns the last path segment of a CWD with a leading slash.
 * e.g. "/Users/dani/code/agent-terminal" → "/agent-terminal"
 *      "/Users/dani"                      → "/dani"
 *      "/"                                → "/"
 */
export function cwdBasename(cwd: string): string {
  const trimmed = cwd.replace(/\/$/, '')
  const slash = trimmed.lastIndexOf('/')
  const last = trimmed.slice(slash + 1)
  return last ? `/${last}` : '/'
}

/**
 * Resolves the display label for a tab.
 *
 * - If the user has explicitly renamed the tab (`userRenamed === true`),
 *   the stored `label` is always used verbatim.
 * - Otherwise the label is derived from the live CWD so it updates
 *   automatically as the user navigates between directories.
 * - Falls back to the stored `label` (usually `"shell"`) when the CWD
 *   is not yet known (e.g. before the first OSC 7 sequence).
 */
export function resolveTabLabel(
  tab: { label: string; userRenamed?: boolean },
  cwd: string | undefined,
): string {
  if (tab.userRenamed) return tab.label
  if (cwd) return cwdBasename(cwd)
  return tab.label
}
