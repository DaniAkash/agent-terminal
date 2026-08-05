import { atom } from 'nanostores'

const MAX_HISTORY = 20

export type ClosedTab = {
  projectId: string
  label: string
  cwd: string | undefined
  closedAt: number
}

/**
 * Stack of recently-closed tabs, most-recent first. In-memory only — closing
 * the app forgets the history (matches Chrome/Firefox behavior). Capped at
 * MAX_HISTORY entries to keep growth bounded.
 */
export const $closedTabs = atom<ClosedTab[]>([])

export function pushClosedTab(entry: ClosedTab): void {
  const next = [entry, ...$closedTabs.get()].slice(0, MAX_HISTORY)
  $closedTabs.set(next)
}

export function popClosedTab(): ClosedTab | undefined {
  const stack = $closedTabs.get()
  if (stack.length === 0) return undefined
  $closedTabs.set(stack.slice(1))
  return stack[0]
}
