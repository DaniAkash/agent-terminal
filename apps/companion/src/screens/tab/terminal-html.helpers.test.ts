import { describe, expect, test } from 'bun:test'
import { TERMINAL_URL_PATTERN } from '@agent-terminal/core-ui'
import {
  buildTerminalHtml,
  DEFAULT_TERMINAL_HTML_CONFIG,
  safeCssColor,
  safeCssFontFamily,
} from './terminal-html.helpers'

describe('safeCssFontFamily', () => {
  test('passes a stack through unquoted so CSS reads it as a list', () => {
    expect(safeCssFontFamily('ui-monospace, "SF Mono", Menlo, monospace')).toBe(
      'ui-monospace, "SF Mono", Menlo, monospace',
    )
  })

  test('rejects a value that would break out of the declaration', () => {
    expect(safeCssFontFamily('monospace; } body { display: none')).toBe(
      'monospace',
    )
    expect(safeCssFontFamily('a</style><script>x()</script>')).toBe('monospace')
  })

  test('falls back when the stack is empty', () => {
    expect(safeCssFontFamily('  ,  ')).toBe('monospace')
  })
})

describe('buildTerminalHtml', () => {
  const html = buildTerminalHtml(DEFAULT_TERMINAL_HTML_CONFIG)

  test('references pinned CDN URLs for wterm, the core and the wasm', () => {
    expect(html).toContain(
      'https://unpkg.com/@wterm/dom@0.5.6/src/terminal.css',
    )
    expect(html).toContain('import("https://esm.sh/@wterm/dom@0.5.6")')
    expect(html).toContain('import("https://esm.sh/@wterm/ghostty@0.5.6")')
    expect(html).toContain(
      'https://unpkg.com/@wterm/ghostty@0.5.6/wasm/ghostty-vt.wasm',
    )
  })

  test('loads as a module, since wterm ships no UMD build', () => {
    expect(html).toContain('<script type="module">')
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
    expect(html).toContain('type: "ready"')
    expect(html).toContain('type: "data"')
    expect(html).toContain('type: "resize"')
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

  test('carries no touch-scroll handler, the scrollback being a real scroll container', () => {
    // xterm needed a hand-written drag-to-scroll handler because its
    // viewport only moved on wheel events. wterm's scrollback overflows
    // natively, so the handler is gone rather than ported.
    expect(html).not.toContain('touchmove')
    expect(html).not.toContain('scrollLines')
    expect(html).toContain('overscroll-behavior: contain')
  })

  test('a failed import posts an error rather than retrying forever', () => {
    expect(html).toContain('type: "error"')
    expect(html).toContain('Failed to load wterm')
    expect(html).not.toContain('BOOT_MAX_ATTEMPTS')
  })

  test('CSS background falls back to safe default if the config value would break out', () => {
    const evil = buildTerminalHtml({
      ...DEFAULT_TERMINAL_HTML_CONFIG,
      themeBackground: 'red; } </style><script>alert(1)</script><style>',
    })
    // The CSS interpolation site must use the sanitised fallback, never
    // the raw payload. The evil string still appears elsewhere in the
    // output because JSON.stringify hands it to the core's colour options
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

describe('terminal font sizing', () => {
  const html = buildTerminalHtml(DEFAULT_TERMINAL_HTML_CONFIG)

  test('emits the font stack as a bare CSS list, never one quoted name', () => {
    // A single quoted name matches no installed font, so the WebView
    // falls back to a proportional face and every column misaligns.
    expect(html).toContain(
      '--term-font-family: ui-monospace, "SF Mono", Menlo, "Roboto Mono", "Droid Sans Mono", monospace;',
    )
    expect(html).not.toContain('--term-font-family: "ui-monospace,')
  })

  test('pins row height to the configured font size', () => {
    expect(html).toContain('--term-row-height: 14px;')
  })
})

describe('keyboard re-pin', () => {
  const html = buildTerminalHtml(DEFAULT_TERMINAL_HTML_CONFIG)

  test('re-pins the scrollback when the viewport shrinks', () => {
    // The soft keyboard shrinks the WebView; without this the prompt
    // sits below the fold because the scroll offset is kept.
    expect(html).toContain(
      'window.visualViewport.addEventListener("resize", repinToBottom)',
    )
    expect(html).toContain('window.addEventListener("resize", repinToBottom)')
    expect(html).toContain('scroller.scrollTop = scroller.scrollHeight')
  })

  test('only re-pins when the view was already at the bottom', () => {
    expect(html).toContain('if (!pinnedToBottom) return;')
  })

  test('ignores the scroll events a shrinking viewport fires itself', () => {
    expect(html).toContain('if (Date.now() < settlingUntil) return;')
  })
})

describe('scrollback and links', () => {
  const html = buildTerminalHtml(DEFAULT_TERMINAL_HTML_CONFIG)

  test('passes an explicit byte budget to the core', () => {
    // The default is 10,000 bytes, roughly 1,260 rows at phone width,
    // well short of the 2,000 lines this terminal used to keep.
    expect(html).toContain('scrollbackLimit: 2000000')
  })

  test('linkifies bare URLs and routes clicks to the native side', () => {
    expect(html).toContain('function linkifyRows(root)')
    expect(html).toContain('post({ type: "openUrl", url: href })')
  })

  test('only hands http and https to the opener', () => {
    expect(html).toContain(
      'url.protocol === "http:" || url.protocol === "https:"',
    )
  })

  test('carries the shared URL pattern rather than a second copy', () => {
    expect(html).toContain(JSON.stringify(TERMINAL_URL_PATTERN.source))
  })
})
