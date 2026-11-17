/**
 * Replace the terminal surface with the reason it could not start.
 *
 * The DOM component has no React tree of its own to fall back to, so the
 * message is written into the host element directly.
 */
export function renderBootFailure(host: HTMLElement, message: string): void {
  host.textContent = ''
  const panel = host.ownerDocument.createElement('div')
  panel.setAttribute('role', 'alert')
  panel.style.cssText =
    'display:flex;flex-direction:column;gap:8px;padding:16px;' +
    'font:13px ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'color:#e6e8eb;background:#0e0f10;height:100%;box-sizing:border-box;' +
    'overflow:auto;-webkit-user-select:text;user-select:text'
  const title = host.ownerDocument.createElement('strong')
  title.textContent = 'The terminal could not start'
  const detail = host.ownerDocument.createElement('span')
  detail.style.cssText =
    'color:#9aa0a6;white-space:pre-wrap;word-break:break-word'
  detail.textContent = message
  panel.append(title, detail)
  host.append(panel)
}

/** The human-readable part of whatever `boot` rejected with. */
export function bootFailureMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return 'Unknown error.'
}
