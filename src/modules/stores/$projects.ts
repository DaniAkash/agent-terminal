import { atom } from 'nanostores'
import { IPC } from '@/modules/ipc/commands'
import {
  dedupeLabel,
  SEED_PROJECTS,
} from '@/screens/workspace/workspace.helpers'
import type { Project, Tab } from '@/screens/workspace/workspace.types'

export const $projects = atom<Project[]>(structuredClone(SEED_PROJECTS))
export const $expanded = atom<Record<string, boolean>>({
  'claude-ui': true,
  'api-service': true,
})

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}

export function toggleExpanded(projectId: string): void {
  const cur = $expanded.get()
  $expanded.set({ ...cur, [projectId]: !cur[projectId] })
}

export function toggleProjectPin(projectId: string): void {
  const updated = $projects
    .get()
    .map((p) => (p.id === projectId ? { ...p, pinned: !p.pinned } : p))
  const sorted = [
    ...updated.filter((p) => p.pinned),
    ...updated.filter((p) => !p.pinned),
  ]
  $projects.set(sorted)
  IPC.saveProjects(sorted)
}

export function toggleTabPin(projectId: string, tabId: string): void {
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
  IPC.saveProjects(updated)
}

export function reorderProjects(oldIndex: number, newIndex: number): void {
  const reordered = arrayMove($projects.get(), oldIndex, newIndex)
  $projects.set(reordered)
  IPC.saveProjects(reordered)
}

export function reorderTabs(
  projectId: string,
  oldIndex: number,
  newIndex: number,
): void {
  const updated = $projects
    .get()
    .map((p) =>
      p.id !== projectId
        ? p
        : { ...p, tabs: arrayMove(p.tabs, oldIndex, newIndex) },
    )
  $projects.set(updated)
  IPC.saveProjects(updated)
}

export function removeProject(projectId: string): void {
  const updated = $projects.get().filter((p) => p.id !== projectId)
  $projects.set(updated)
  IPC.saveProjects(updated)
}

export function removeTab(projectId: string, tabId: string): void {
  const updated = $projects
    .get()
    .map((p) =>
      p.id !== projectId
        ? p
        : { ...p, tabs: p.tabs.filter((t) => t.id !== tabId) },
    )
  $projects.set(updated)
  IPC.saveProjects(updated)
}

export function addTab(projectId: string): Tab | null {
  const projects = $projects.get()
  const project = projects.find((p) => p.id === projectId)
  if (!project) return null
  const label = dedupeLabel(project.tabs.map((t) => t.label))
  const newTab: Tab = {
    id: `${projectId}-${label}`,
    label,
    cmd: '',
    running: false,
    pinned: false,
  }
  $projects.set(
    projects.map((p) =>
      p.id !== projectId ? p : { ...p, tabs: [...p.tabs, newTab] },
    ),
  )
  return newTab
}
