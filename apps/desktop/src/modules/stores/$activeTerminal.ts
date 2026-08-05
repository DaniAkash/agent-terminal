import { atom, computed } from 'nanostores'
import type { XTermHandle } from '@/components/XTermTerminal/XTermTerminal'
import { $activeProjectId, $activeTabId } from '@/modules/stores/$navigation'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'

/** Every mounted pane's handle, keyed by `${projectId}:${tabId}`. */
export const $terminalHandles = atom<Map<string, XTermHandle>>(new Map())

/** Active tab key derived from navigation; null when nothing is selected. */
export const $activeTabKey = computed(
  [$activeProjectId, $activeTabId],
  (projectId, activeTabsByProject) => {
    const tabId = activeTabsByProject[projectId]
    if (!projectId || !tabId) return null
    return makeTabKey(projectId, tabId)
  },
)

export function registerTerminalHandle(
  tabKey: string,
  handle: XTermHandle,
): void {
  const next = new Map($terminalHandles.get())
  next.set(tabKey, handle)
  $terminalHandles.set(next)
}

export function unregisterTerminalHandle(
  tabKey: string,
  handle: XTermHandle,
): void {
  // Identity guard: a same-key re-register can land before this cleanup
  // runs; without the guard we'd wipe the newer handle.
  const current = $terminalHandles.get().get(tabKey)
  if (current !== handle) return
  const next = new Map($terminalHandles.get())
  next.delete(tabKey)
  $terminalHandles.set(next)
}

export function getActiveTerminalHandle(): XTermHandle | null {
  const key = $activeTabKey.get()
  if (!key) return null
  return $terminalHandles.get().get(key) ?? null
}
