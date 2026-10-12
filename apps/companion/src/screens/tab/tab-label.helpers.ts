import type { TabSummary } from '@/modules/wss/protocol.gen'

/**
 * Last path segment of a working directory, with a leading slash.
 *
 * Mirrors the desktop's `cwdBasename` in
 * `src/screens/workspace/workspace.helpers.ts`. The two must agree: a
 * session shown as `/control-center` on the desktop and `shell 2` on the
 * phone is the same session, and anyone looking at both has to work that
 * out for themselves.
 */
export function cwdBasename(cwd: string): string {
  const trimmed = cwd.replace(/\/$/, '')
  const slash = trimmed.lastIndexOf('/')
  const last = trimmed.slice(slash + 1)
  return last ? `/${last}` : '/'
}

/**
 * The name to show for a session, matching the desktop's
 * `resolveTabLabel`.
 *
 * A name the user typed is always kept. Otherwise the directory stands in
 * for it, so an unnamed session reads as where it is rather than as the
 * order it happened to be created in. The stored label is the fallback for
 * a session whose directory is not known yet, which is what a tree loaded
 * from disk looks like before the first shell integration event.
 */
export function sessionLabel(
  tab: Pick<TabSummary, 'label' | 'user_renamed' | 'cwd' | 'last_cwd'>,
  liveCwd?: string | undefined,
): string {
  if (tab.user_renamed) return tab.label
  const cwd = liveCwd ?? tab.cwd ?? tab.last_cwd
  return cwd ? cwdBasename(cwd) : tab.label
}
