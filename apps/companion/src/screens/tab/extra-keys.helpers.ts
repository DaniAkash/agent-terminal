export const SEQ = {
  esc: '\x1b',
  tab: '\t',
  slash: '/',
  dash: '-',
  home: '\x1b[H',
  end: '\x1b[F',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  arrowUp: '\x1b[A',
  arrowDown: '\x1b[B',
  arrowLeft: '\x1b[D',
  arrowRight: '\x1b[C',
} as const

// Ctrl only maps to a control code when combined with a letter (Ctrl+A → 0x01,
// Ctrl+Z → 0x1a). Punctuation, digits, and multi-char sequences are passed
// through unchanged rather than mangled through the `& 0x1f` bitmask (e.g.
// Ctrl+/ would otherwise emit \x0f, Ctrl+- would emit \r).
export function applyCtrl(input: string): string {
  if (input.length !== 1) return input
  if (!/^[a-zA-Z]$/.test(input)) return input
  const code = input.charCodeAt(0)
  return String.fromCharCode(code & 0x1f)
}

export function applyAlt(input: string): string {
  return `\x1b${input}`
}
