import { describe, expect, test } from 'bun:test'
import { hrefForSpanText, openableHref } from '@agent-terminal/core-ui'

describe('hrefForSpanText', () => {
  test('accepts a bare http and https URL', () => {
    expect(hrefForSpanText('https://example.com')).toBe('https://example.com/')
    expect(hrefForSpanText('http://example.com/a?b=1')).toBe(
      'http://example.com/a?b=1',
    )
  })

  test('tolerates the padding a terminal cell run carries', () => {
    expect(hrefForSpanText('  https://example.com  ')).toBe(
      'https://example.com/',
    )
  })

  // A URL at the end of a sentence picks up the full stop, and following
  // it would 404.
  test('drops sentence punctuation from the href', () => {
    expect(hrefForSpanText('https://example.com/docs.')).toBe(
      'https://example.com/docs',
    )
    expect(hrefForSpanText('https://example.com/a)')).toBe(
      'https://example.com/a',
    )
  })

  test('rejects a span that is more than the URL', () => {
    expect(hrefForSpanText('see https://example.com')).toBeNull()
    expect(hrefForSpanText('https://example.com now')).toBeNull()
  })

  // Only schemes a browser should be handed. A file or javascript URL
  // reaching the opener would be a real problem.
  test('rejects non-web schemes and plain text', () => {
    expect(hrefForSpanText('javascript:alert(1)')).toBeNull()
    expect(hrefForSpanText('file:///etc/passwd')).toBeNull()
    expect(hrefForSpanText('example.com')).toBeNull()
    expect(hrefForSpanText('')).toBeNull()
    expect(hrefForSpanText('   ')).toBeNull()
  })
})

describe('openableHref', () => {
  // OSC 8 hrefs come from whatever produced the output, so the host
  // checks every anchor it is about to open, not just linkified ones.
  test('passes http and https through, normalised', () => {
    expect(openableHref('https://example.com')).toBe('https://example.com/')
    expect(openableHref('http://example.com/a?b=1')).toBe(
      'http://example.com/a?b=1',
    )
  })

  test('rejects schemes an OS opener should never be handed', () => {
    expect(openableHref('file:///etc/passwd')).toBeNull()
    expect(openableHref('javascript:alert(1)')).toBeNull()
    expect(openableHref('data:text/html,<script>x()</script>')).toBeNull()
    expect(openableHref('vscode://file/etc/passwd')).toBeNull()
  })

  test('rejects anything that is not a URL, including a missing attribute', () => {
    expect(openableHref(null)).toBeNull()
    expect(openableHref(undefined)).toBeNull()
    expect(openableHref('')).toBeNull()
    expect(openableHref('not a url')).toBeNull()
  })
})
