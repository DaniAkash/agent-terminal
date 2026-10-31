import {
  TERMINAL_TRAILING_PUNCTUATION,
  TERMINAL_URL_PATTERN,
} from '@agent-terminal/core-ui'

export interface TerminalHtmlConfig {
  wtermVersion: string
  initialCols: number
  initialRows: number
  fontFamily: string
  fontSize: number
  /** ghostty's scrollback budget, in bytes rather than lines. */
  scrollbackBytes: number
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
  // Measured against this core: 2 MB holds about 2,085 rows at the 57
  // columns a phone shows, covering the 2,000 lines xterm was
  // configured for. The default is 10,000 bytes, about 1,260 rows.
  scrollbackBytes: 2_000_000,
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
  // The page runs library code fetched at runtime, so it cannot import
  // the linkifier. The patterns are interpolated from the shared module
  // instead, which keeps the scheme matching from drifting between the
  // platforms even though the loop below is written out again here.
  const urlPattern = TERMINAL_URL_PATTERN.source
  const trailingPattern = TERMINAL_TRAILING_PUNCTUATION.source
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
    scrollbackLimit: ${config.scrollbackBytes},
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

  // The soft keyboard shrinks the WebView, and wterm keeps its scroll
  // offset across the re-fit, so the live prompt ends up far below the
  // fold. Re-pin after the reflow lands, and only when the view was
  // already at the bottom, so a reader who scrolled up into history is
  // not yanked back down.
  // wterm puts its class on the host element rather than nesting, and
  // .wterm is what the stylesheet gives overflow-y, so the class is the
  // thing to query: it names the scroll container wherever it sits.
  const scroller = document.querySelector(".wterm");
  const BOTTOM_SLACK_PX = 4;
  let pinnedToBottom = true;
  let settlingUntil = 0;

  function isAtBottom() {
    return (
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <=
      BOTTOM_SLACK_PX
    );
  }

  scroller.addEventListener(
    "scroll",
    function () {
      // A shrinking viewport fires scroll events of its own, and they
      // read as "not at the bottom" before the re-pin runs. Only a
      // scroll outside that settling window counts as the user's.
      if (Date.now() < settlingUntil) return;
      pinnedToBottom = isAtBottom();
    },
    { passive: true },
  );

  function repinToBottom() {
    // The keyboard animates, so resize fires repeatedly; each pass keeps
    // the prompt in view until the viewport stops moving.
    settlingUntil = Date.now() + 500;
    if (!pinnedToBottom) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (pinnedToBottom) scroller.scrollTop = scroller.scrollHeight;
      });
    });
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", repinToBottom);
  }
  window.addEventListener("resize", repinToBottom);

  // wterm anchors OSC 8 hyperlinks only, so a printed URL stays plain
  // text until it is wrapped, and the old web-links addon is what used
  // to do this. Only a span that is entirely a URL is wrapped: each one
  // carries an explicit width in cells, so splitting one would break
  // the column alignment of the rest of the row.
  const URL_RE = new RegExp(${JSON.stringify(urlPattern)});
  const TRAILING_RE = new RegExp(${JSON.stringify(trailingPattern)});

  function hrefForSpanText(text) {
    const trimmed = text.trim();
    if (!trimmed || !URL_RE.test(trimmed)) return null;
    const stripped = trimmed.replace(TRAILING_RE, "");
    if (!stripped) return null;
    return openableHref(stripped);
  }

  function openableHref(href) {
    try {
      const url = new URL(href);
      return url.protocol === "http:" || url.protocol === "https:"
        ? url.href
        : null;
    } catch (err) {
      return null;
    }
  }

  function linkifyRows(root) {
    for (const span of root.querySelectorAll(".term-row span")) {
      if (span.closest("a")) continue;
      const href = hrefForSpanText(span.textContent || "");
      if (!href) continue;
      const anchor = document.createElement("a");
      anchor.className = "term-link";
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      span.replaceWith(anchor);
      anchor.appendChild(span);
    }
  }

  // wterm rebuilds a row's markup on every repaint, which discards the
  // previous pass's anchors, so this runs per frame rather than once.
  let linkFrame = 0;
  linkifyRows(scroller);
  new MutationObserver(function () {
    if (linkFrame !== 0) return;
    linkFrame = requestAnimationFrame(function () {
      linkFrame = 0;
      linkifyRows(scroller);
    });
  }).observe(scroller, { childList: true, subtree: true });

  // The WebView cannot open a link, and following one in place would
  // replace the terminal with the page. Anchors go out to the native
  // side instead, and only once the scheme checks out: an OSC 8 href is
  // written by whatever produced the output.
  scroller.addEventListener(
    "click",
    function (e) {
      const anchor = e.target && e.target.closest && e.target.closest("a[href]");
      if (!anchor) return;
      const raw = anchor.getAttribute("href");
      if (!raw) return;
      e.preventDefault();
      const href = openableHref(raw);
      if (!href) return;
      post({ type: "openUrl", url: href });
    },
    true,
  );

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
