import type { Href } from 'expo-router'
/**
 * Rebuild the wire's tab identifier from the two route params.
 *
 * `TabSummary.tab_id` arrives already composed as `<project_id>:<raw_id>`
 * and every stream op (subscribe, write, resize) addresses tabs by it.
 * The route carries the two ids separately because the mutating ops need
 * the project id in its own right, so this puts them back together for
 * the stream side.
 */
export function composedTabId(projectId: string, tabId: string): string {
  const prefix = `${projectId}:`
  return tabId.startsWith(prefix) ? tabId : `${prefix}${tabId}`
}

/**
 * The raw tab id, with the project prefix taken back off.
 *
 * `TabSummary.tab_id` is composed by Rust, so anything that wants the bare id
 * (route params, desktop store lookups) has to strip it rather than assume the
 * wire value is already raw.
 */
export function rawTabId(projectId: string, wireTabId: string): string {
  const prefix = `${projectId}:`
  return wireTabId.startsWith(prefix)
    ? wireTabId.slice(prefix.length)
    : wireTabId
}

/** Split a composed wire id back into its parts for route params. */
export function splitTabId(
  composed: string,
): { projectId: string; tabId: string } | null {
  const at = composed.indexOf(':')
  if (at <= 0 || at === composed.length - 1) return null
  return {
    projectId: composed.slice(0, at),
    tabId: composed.slice(at + 1),
  }
}

/**
 * Route for a tab given the project it belongs to and its wire id. The
 * wire id arrives composed, so the project prefix is stripped back off to
 * fill the two route params.
 */
export function tabHref(projectId: string, wireTabId: string): Href {
  return `/tab/${projectId}/${rawTabId(projectId, wireTabId)}` as Href
}

export type TerminalRouteAction = 'pair' | 'render'

/**
 * What the terminal route should do for the current device state.
 *
 * Deliberately not gated on the connection. Losing the desktop used to
 * send the user to the pairing screen, which threw away the scrollback
 * they were reading and the keystrokes they were about to queue. A
 * dropped connection is a state the terminal shows, not a reason to leave
 * it; only an unpaired phone has nothing to render. While the stored
 * devices are still being read, rendering is the better guess, since the
 * common case by far is that one is about to arrive.
 */
export function terminalRouteAction(device: {
  loaded: boolean
  record: unknown | null
}): TerminalRouteAction {
  return device.loaded && !device.record ? 'pair' : 'render'
}
