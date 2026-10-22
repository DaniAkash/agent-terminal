import { ageBuckets, type SessionRow } from '@agent-terminal/core-ui'

/* ---------------------------------------------------------------------------
 * Desktop-only helpers for the Cmd+P tab switcher.
 *
 * Ordering, ranking and labelling all come from the shared package now,
 * so the palette, the sidebar and the phone cannot disagree about which
 * session is where. What is left here is the palette's own: a search the
 * other surfaces do not have, and a time format sized for a wide row.
 * -------------------------------------------------------------------------*/

/**
 * Substring filter across label, workspace name and cwd. Preserves the
 * input order so recency ranking survives among the matches.
 *
 * Case-insensitive. An empty query returns the same array reference, so
 * callers can rely on that for memoisation.
 */
export function filterSwitcherRows(
  rows: SessionRow[],
  query: string,
  cwdFor: (row: SessionRow) => string | undefined,
): SessionRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => {
    const hay = `${r.label} ${r.projectName} ${cwdFor(r) ?? ''}`.toLowerCase()
    return hay.includes(q)
  })
}

/**
 * Relative time for the palette's metadata line.
 *
 *   undefined → 'never'      < 10s  → 'just now'
 *   < 60s     → 'Ns ago'     < 60m  → 'Nm ago'
 *   < 24h     → 'Nh ago'     1 day  → 'yesterday'
 *   < 7d      → 'Nd ago'     < 30d  → 'Nw ago'
 *   else      → 'Nmo ago'
 *
 * The phone has its own shorter wording for a narrower column. The
 * arithmetic is shared; the words are not, because one string that fits
 * both surfaces would fit neither well.
 */
export function formatRelativeTime(
  now: number,
  then: number | undefined,
): string {
  const age = ageBuckets(now, then)
  if (age === null) return 'never'
  if (age.seconds < 10) return 'just now'
  if (age.seconds < 60) return `${age.seconds}s ago`
  if (age.minutes < 60) return `${age.minutes}m ago`
  if (age.hours < 24) return `${age.hours}h ago`
  if (age.days === 1) return 'yesterday'
  if (age.days < 7) return `${age.days}d ago`
  if (age.days < 30) return `${Math.floor(age.days / 7)}w ago`
  return `${Math.floor(age.days / 30)}mo ago`
}
