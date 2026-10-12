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
  const prefix = `${projectId}:`
  const raw = wireTabId.startsWith(prefix)
    ? wireTabId.slice(prefix.length)
    : wireTabId
  return `/tab/${projectId}/${raw}` as Href
}
