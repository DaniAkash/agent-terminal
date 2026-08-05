import { describe, expect, test } from 'bun:test'
import {
  buildTerminalHtml,
  DEFAULT_TERMINAL_HTML_CONFIG,
  safeCssColor,
} from './terminal-html.helpers'

describe('buildTerminalHtml', () => {
  const html = buildTerminalHtml(DEFAULT_TERMINAL_HTML_CONFIG)

  test('references pinned unpkg URLs for xterm + addons', () => {
    expect(html).toContain('https://unpkg.com/@xterm/xterm@6.0.0/css/xterm.css')
    expect(html).toContain('https://unpkg.com/@xterm/xterm@6.0.0/lib/xterm.js')
    expect(html).toContain(
      'https://unpkg.com/@xterm/addon-fit@0.11.0/lib/addon-fit.js',
    )
    expect(html).toContain(
      'https://unpkg.com/@xterm/addon-web-links@0.12.0/lib/addon-web-links.js',
    )
  })

  test('embeds initial cols and rows from config', () => {
    expect(html).toContain('cols: 80')
    expect(html).toContain('rows: 24')
  })

  test('installs the RN bridge as window.__terminal_bridge with write/clear/fit', () => {
    expect(html).toContain('window.__terminal_bridge')
    expect(html).toContain('write: function')
    expect(html).toContain('clear: function')
    expect(html).toContain('fit: function')
  })

  test('posts ready/data/resize message types to RN', () => {
    expect(html).toContain("type: 'ready'")
    expect(html).toContain("type: 'data'")
    expect(html).toContain("type: 'resize'")
  })

  test('sets viewport meta for mobile scaling', () => {
    expect(html).toContain('name="viewport"')
    expect(html).toContain('initial-scale=1')
  })

  test('quotes theme values through JSON.stringify (no raw templating)', () => {
    const evil = buildTerminalHtml({
      ...DEFAULT_TERMINAL_HTML_CONFIG,
      themeBackground: 'red"; window.pwned = true; //',
    })
    // JSON.stringify keeps the string escaped; the payload appears only
    // as a quoted string literal, never as bare JS.
    expect(evil).toContain('"red\\"; window.pwned = true; //"')
  })

  test('boot loader has a max-retry cap and posts an error on timeout', () => {
    expect(html).toContain('BOOT_MAX_ATTEMPTS')
    expect(html).toContain("type: 'error'")
    expect(html).toContain('Failed to load xterm.js from unpkg')
  })

  test('CSS background falls back to safe default if the config value would break out', () => {
    const evil = buildTerminalHtml({
      ...DEFAULT_TERMINAL_HTML_CONFIG,
      themeBackground: 'red; } </style><script>alert(1)</script><style>',
    })
    // The CSS interpolation site must use the sanitised fallback, never
    // the raw payload. The evil string still appears elsewhere in the
    // output because JSON.stringify hands it to xterm.js's theme object
    // as a quoted string literal inside <script>, which is safe.
    expect(evil).toMatch(/background:\s*#000000;\s*overflow:\s*hidden/)
  })
})

describe('safeCssColor', () => {
  test('accepts hex colors', () => {
    expect(safeCssColor('#000')).toBe('#000')
    expect(safeCssColor('#000000')).toBe('#000000')
    expect(safeCssColor('#0e0f10')).toBe('#0e0f10')
    expect(safeCssColor('#0e0f10ff')).toBe('#0e0f10ff')
  })

  test('accepts rgb / rgba', () => {
    expect(safeCssColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)')
    expect(safeCssColor('rgba(1, 2, 3, 0.5)')).toBe('rgba(1, 2, 3, 0.5)')
  })

  test('accepts oklch', () => {
    expect(safeCssColor('oklch(0.55 0.18 225)')).toBe('oklch(0.55 0.18 225)')
  })

  test('accepts named colors', () => {
    expect(safeCssColor('red')).toBe('red')
    expect(safeCssColor('transparent')).toBe('transparent')
  })

  test('rejects style-tag breakout attempts and falls back', () => {
    expect(
      safeCssColor('red; } </style><script>alert(1)</script><style>'),
    ).toBe('#000000')
    expect(safeCssColor('#000; background: url(evil)')).toBe('#000000')
    expect(safeCssColor('javascript:evil()')).toBe('#000000')
  })
})
