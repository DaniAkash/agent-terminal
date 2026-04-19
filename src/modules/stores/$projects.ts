import { atom } from 'nanostores'
import { SEED_PROJECTS } from '@/screens/workspace/workspace.helpers'
import type { Project } from '@/screens/workspace/workspace.types'

export const $projects = atom<Project[]>(structuredClone(SEED_PROJECTS))
export const $expanded = atom<Record<string, boolean>>({
  'claude-ui': true,
  'api-service': true,
})

export function toggleProjectPin(projectId: string) {
  const updated = $projects
    .get()
    .map((p) => (p.id === projectId ? { ...p, pinned: !p.pinned } : p))
  const sorted = [
    ...updated.filter((p) => p.pinned),
    ...updated.filter((p) => !p.pinned),
  ]
  $projects.set(sorted)
}

export function toggleTabPin(projectId: string, tabId: string) {
  const updated = $projects.get().map((p) => {
    if (p.id !== projectId) return p
    const tabs = p.tabs.map((t) =>
      t.id === tabId ? { ...t, pinned: !t.pinned } : t,
    )
    const sorted = [
      ...tabs.filter((t) => t.pinned),
      ...tabs.filter((t) => !t.pinned),
    ]
    return { ...p, tabs: sorted }
  })
  $projects.set(updated)
}
