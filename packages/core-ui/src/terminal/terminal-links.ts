/**
 * Bare URLs in terminal output, turned into links.
 *
 * wterm only draws an anchor for a cell the terminal marked as a
 * hyperlink with OSC 8. Almost nothing an agent or a shell prints does
 * that, so without this a printed URL is plain text, which is a
 * capability xterm's web-links addon used to provide on every platform.
 *
 * Only a span whose whole text is a URL is wrapped. Each span carries an
 * explicit width in cells, so splitting one to wrap part of its text
 * would break the column alignment of everything after it on that row. A
 * URL almost always lands in a span of its own anyway, because the
 * colour change around it already ends the preceding run.
 *
 * The wrapper is the same `a.term-link` wterm emits for OSC 8, so the
 * hover underline, the pointer cursor under the activation modifier, and
 * the host's click handling all apply without a second code path.
 */

export const TERMINAL_URL_PATTERN = /^(https?:\/\/[^\s<>"'`]+)$/

/** Punctuation that ends a sentence rather than the URL inside it. */
export const TERMINAL_TRAILING_CHARS = `.,;:!?)]}>'"`

/**
 * Drop sentence punctuation from the end of a URL.
 *
 * A scan rather than a `/[...]+$/` replace: that pattern has no start
 * anchor, so the engine retries from every offset and a long run of one
 * of these characters costs O(n^2). Span text is row-bounded today, but
 * nothing in this module's signature promises that.
 */
export function stripTrailingPunctuation(text: string): string {
  let end = text.length
  while (end > 0 && TERMINAL_TRAILING_CHARS.includes(text[end - 1] ?? ''))
    end -= 1
  return text.slice(0, end)
}

/** Schemes an anchor may hand to an OS opener. */
const OPENABLE_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Normalise an href for opening, or reject it.
 *
 * Applied to every anchor a host is about to open, not just the ones
 * linkified here: an OSC 8 href is written by whatever produced the
 * output, so it can name any scheme it likes, including `file:` and
 * `javascript:`.
 */
export function openableHref(href: string | null | undefined): string | null {
  if (!href) return null
  try {
    const url = new URL(href)
    return OPENABLE_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function hrefForSpanText(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  if (!TERMINAL_URL_PATTERN.test(trimmed)) return null
  const stripped = stripTrailingPunctuation(trimmed)
  if (stripped.length === 0) return null
  return openableHref(stripped)
}

/**
 * Wrap every span that is entirely a URL. Idempotent: a span already
 * inside an anchor is skipped, so re-running over an unchanged row is a
 * no-op and the observer that drives this cannot loop.
 */
export function linkifyRows(root: ParentNode): number {
  const doc = (root as Element).ownerDocument ?? (root as unknown as Document)
  let wrapped = 0
  for (const span of root.querySelectorAll('.term-row span')) {
    if (span.closest('a')) continue
    const href = hrefForSpanText(span.textContent ?? '')
    if (!href) continue
    const anchor = doc.createElement('a')
    anchor.className = 'term-link'
    anchor.href = href
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    span.replaceWith(anchor)
    anchor.appendChild(span)
    wrapped += 1
  }
  return wrapped
}
