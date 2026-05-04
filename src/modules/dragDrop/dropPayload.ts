/**
 * POSIX-shell-quotes a single path. Wraps in single quotes and escapes
 * any single quotes inside as `'\''` (close, escape, reopen). Handles
 * spaces, dollar signs, backticks, parentheses, glob characters —
 * everything readline / a shell parser would otherwise interpret.
 */
export function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`
}

/**
 * Formats one or more dropped file paths into a single string ready to
 * write to the PTY. Each path is shell-quoted, multiple paths are
 * space-separated, and a trailing space is appended so the user can
 * keep typing afterward without manually adding the separator.
 *
 * Returns an empty string for an empty path list (caller can no-op
 * cleanly without checking length).
 */
export function formatDropPayload(paths: readonly string[]): string {
  if (paths.length === 0) return ''
  return `${paths.map(shellQuote).join(' ')} `
}
