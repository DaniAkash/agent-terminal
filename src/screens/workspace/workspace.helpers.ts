export const MONO_FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace'

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
