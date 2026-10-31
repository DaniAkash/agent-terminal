export interface TerminalHtmlConfig {
  wtermVersion: string
  initialCols: number
  initialRows: number
  fontFamily: string
  fontSize: number
  scrollback: number
  themeBackground: string
  themeForeground: string
  themeCursor: string
}

export const DEFAULT_TERMINAL_HTML_CONFIG: TerminalHtmlConfig = {
  wtermVersion: '0.5.6',
  initialCols: 80,
  initialRows: 24,
  fontFamily:
    'ui-monospace, "SF Mono", Menlo, "Roboto Mono", "Droid Sans Mono", monospace',
  fontSize: 12,
  scrollback: 2000,
  themeBackground: '#0e0f10',
  themeForeground: '#e6e8eb',
  themeCursor: '#e6e8eb',
}

// Whitelist-based CSS color validator. Accepts hex, rgb/rgba, oklch, and
// bare-letter named colors. Anything else falls back to a safe default,
// preventing style-tag breakout via strings like `red; } </style>`. The
// JS side already uses JSON.stringify for the same reason; this brings
// CSS to parity.
const SAFE_CSS_FALLBACK = '#000000'

export function safeCssColor(input: string): string {
  if (/^#[0-9a-f]{3,8}$/i.test(input)) return input
  if (/^rgba?\([\d\s,.%]+\)$/i.test(input)) return input
  if (/^oklch\([\d\s,./%]+\)$/i.test(input)) return input
  if (/^[a-z]+$/i.test(input)) return input
  return SAFE_CSS_FALLBACK
}

const SAFE_FONT_FALLBACK = 'monospace'
const BARE_FAMILY = /^[a-z][\w-]*(?: [\w-]+)*$/i
const QUOTED_FAMILY = /^"[\w\s-]+"$/

// A font stack has to reach CSS unquoted: JSON.stringify would wrap the
// whole list in one pair of quotes, which CSS reads as a single family
// name nothing can match, silently falling back to a proportional face
// and breaking every column. Validate the list instead of escaping it.
export function safeCssFontFamily(input: string): string {
  const families = input
    .split(',')
    .map((family) => family.trim())
    .filter(Boolean)
  if (families.length === 0) return SAFE_FONT_FALLBACK
  const safe = families.every(
    (family) => BARE_FAMILY.test(family) || QUOTED_FAMILY.test(family),
  )
  return safe ? families.join(', ') : SAFE_FONT_FALLBACK
}

export function buildTerminalHtml(config: TerminalHtmlConfig): string {
  const cssBackground = safeCssColor(config.themeBackground)
  const cssFontFamily = safeCssFontFamily(config.fontFamily)
  const v = config.wtermVersion
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/@wterm/dom@${v}/src/terminal.css">
<style>
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: ${cssBackground}; overflow: hidden; }
  #terminal { position: absolute; inset: 0; }
  /* wterm draws cells as DOM nodes and makes the scrollback a real
     overflow container, so a finger scrolls it like any other page and
     the touch handler xterm needed is gone. overscroll-behavior keeps a
     flick past the top from turning into a WebView pull-to-refresh. */
  .wterm {
    width: 100%;
    height: 100%;
    padding: 0;
    border-radius: 0;
    box-shadow: none;
    overscroll-behavior: contain;
    --term-font-family: ${cssFontFamily};
    --term-font-size: ${config.fontSize}px;
    --term-line-height: 1.2;
    /* Rows size off --term-row-height, not line-height; leaving the
       stylesheet default pairs 12px text with 17px rows. */
    --term-row-height: ${Math.round(config.fontSize * 1.2)}px;
  }
</style>
</head>
<body>
<div id="terminal"></div>
<script type="module">
function post(msg) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }
}

// wterm ships ESM only, so this is a module import rather than the UMD
// globals xterm exposed. A failed import rejects here instead of never
// defining a global, which is why there is no retry loop any more: the
// offline and CDN-down cases both land in the catch on the first try.
try {
  const [{ WTerm }, { GhosttyCore }] = await Promise.all([
    import("https://esm.sh/@wterm/dom@${v}"),
    import("https://esm.sh/@wterm/ghostty@${v}"),
  ]);

  const core = await GhosttyCore.load({
    // esm.sh rewrites module paths, so the binary is addressed on unpkg
    // rather than left to the loader's import.meta.url default.
    wasmPath: "https://unpkg.com/@wterm/ghostty@${v}/wasm/ghostty-vt.wasm",
    foregroundColor: ${JSON.stringify(config.themeForeground)},
    backgroundColor: ${JSON.stringify(config.themeBackground)},
  });

  const term = new WTerm(document.getElementById("terminal"), {
    core,
    cols: ${config.initialCols},
    rows: ${config.initialRows},
    autoResize: true,
    cursorBlink: true,
    onData: function (data) { post({ type: "data", payload: data }); },
    onResize: function (cols, rows) { post({ type: "resize", cols: cols, rows: rows }); },
  });
  await term.init();

  window.__terminal_bridge = {
    write: function (data) { term.write(data); },
    // wterm has no clear(); erase the screen, the scrollback, then home.
    clear: function () { term.write("\\u001b[2J\\u001b[3J\\u001b[H"); },
    fit: function () { term.fit(); },
    // The keyboard is raised by focus changing, and the terminal holds
    // its hidden textarea's focus after the keyboard goes, so without
    // this a later tap is not a change and nothing comes up.
    blurInput: function () {
      const textarea = term.element.querySelector("textarea");
      if (textarea) textarea.blur();
    },
  };

  post({ type: "ready" });
} catch (err) {
  post({ type: "error", message: "Failed to load wterm: " + (err && err.message ? err.message : String(err)) });
}
</script>
</body>
</html>`
}
