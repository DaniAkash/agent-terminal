export interface TerminalHtmlConfig {
  xtermVersion: string
  fitAddonVersion: string
  webLinksAddonVersion: string
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
  xtermVersion: '6.0.0',
  fitAddonVersion: '0.11.0',
  webLinksAddonVersion: '0.12.0',
  initialCols: 80,
  initialRows: 24,
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
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

export function buildTerminalHtml(config: TerminalHtmlConfig): string {
  const cssBackground = safeCssColor(config.themeBackground)
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/@xterm/xterm@${config.xtermVersion}/css/xterm.css">
<style>
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; background: ${cssBackground}; overflow: hidden; }
  #terminal { position: absolute; inset: 0; }
  /* xterm has no touch scrolling of its own: its viewport moves on a
     wheel event or a scrollbar drag, neither of which a finger produces.
     touch-action: none stops the browser and xterm's selection handler
     both claiming the drag, leaving it for the listener attached below,
     which is what actually moves the viewport. */
  .xterm-viewport, .xterm-screen { touch-action: none; }
</style>
</head>
<body>
<div id="terminal"></div>
<script src="https://unpkg.com/@xterm/xterm@${config.xtermVersion}/lib/xterm.js"></script>
<script src="https://unpkg.com/@xterm/addon-fit@${config.fitAddonVersion}/lib/addon-fit.js"></script>
<script src="https://unpkg.com/@xterm/addon-web-links@${config.webLinksAddonVersion}/lib/addon-web-links.js"></script>
<script>
(function () {
  // xterm scrolls its viewport on wheel events and scrollbar drags. A
  // finger produces neither, which is why 2000 lines of scrollback were
  // unreachable on a touch device no matter how the host WebView was
  // configured. Translate the drag into scrollLines() ourselves.
  //
  // Movement accumulates in fractional rows so a slow drag still moves:
  // truncating each frame's delta to a whole line would floor every small
  // movement to zero and the viewport would never budge.
  function attachTouchScroll(term) {
    var el = term.element;
    if (!el) return;
    var lastY = null;
    var carry = 0;
    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { lastY = null; return; }
      lastY = e.touches[0].clientY;
      carry = 0;
    }, { passive: true });
    el.addEventListener('touchmove', function (e) {
      if (lastY === null || e.touches.length !== 1) return;
      var y = e.touches[0].clientY;
      var dy = y - lastY;
      lastY = y;
      var rows = term.rows || 1;
      var cell = el.clientHeight / rows;
      if (!cell) return;
      carry += dy / cell;
      var lines = carry > 0 ? Math.floor(carry) : Math.ceil(carry);
      if (lines === 0) return;
      carry -= lines;
      // Dragging down reveals earlier output, which is a negative scroll.
      term.scrollLines(-lines);
      e.preventDefault();
    }, { passive: false });
    var end = function () { lastY = null; };
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
  }

  function post(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

  // Max ~10 s (200 * 50 ms) waiting for the unpkg UMDs to register on
  // window. If the tab is offline, on a captive-portal wifi, or unpkg is
  // down, stop retrying and post an error so RN can log + optionally
  // surface it. Prevents an infinite battery-draining loop.
  var bootAttempts = 0;
  var BOOT_MAX_ATTEMPTS = 200;

  function boot() {
    if (!window.Terminal || !window.FitAddon || !window.WebLinksAddon) {
      bootAttempts += 1;
      if (bootAttempts >= BOOT_MAX_ATTEMPTS) {
        post({ type: 'error', message: 'Failed to load xterm.js from unpkg (timeout)' });
        return;
      }
      setTimeout(boot, 50);
      return;
    }
    var term = new window.Terminal({
      cols: ${config.initialCols},
      rows: ${config.initialRows},
      fontFamily: ${JSON.stringify(config.fontFamily)},
      fontSize: ${config.fontSize},
      cursorBlink: true,
      scrollback: ${config.scrollback},
      theme: {
        background: ${JSON.stringify(config.themeBackground)},
        foreground: ${JSON.stringify(config.themeForeground)},
        cursor: ${JSON.stringify(config.themeCursor)},
      },
    });
    var fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new window.WebLinksAddon.WebLinksAddon());
    term.open(document.getElementById('terminal'));

    attachTouchScroll(term);

    term.onData(function (data) { post({ type: 'data', payload: data }); });
    term.onResize(function (e) { post({ type: 'resize', cols: e.cols, rows: e.rows }); });

    fit.fit();

    var observer = new ResizeObserver(function () { fit.fit(); });
    observer.observe(document.getElementById('terminal'));

    window.__terminal_bridge = {
      write: function (data) { term.write(data); },
      clear: function () { term.clear(); },
      fit: function () { fit.fit(); },
    };

    post({ type: 'ready' });
  }

  boot();
})();
</script>
</body>
</html>`
}
