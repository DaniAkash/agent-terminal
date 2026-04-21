import { atom } from 'nanostores'
import { IPC } from '@/modules/ipc/commands'
import {
  dedupeLabel,
  makeTabKey,
  randomSuffix,
  slugify,
} from '@/screens/workspace/workspace.helpers'
import type { Project, Tab } from '@/screens/workspace/workspace.types'

export const $projects = atom<Project[]>([])
export const $expanded = atom<Record<string, boolean>>({})

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
  const updated = $projects.get().map((p) => {
    if (p.id !== projectId) return p
    const ordered = [
      ...p.tabs.filter((t) => t.pinned),
      ...p.tabs.filter((t) => !t.pinned),
    ]
    return { ...p, tabs: arrayMove(ordered, oldIndex, newIndex) }
  })
  $projects.set(updated)
  IPC.saveProjects(updated)
}

export function removeProject(projectId: string): void {
  const projects = $projects.get()
  const project = projects.find((p) => p.id === projectId)
  if (project) {
    for (const tab of project.tabs) {
      IPC.closeTab(makeTabKey(projectId, tab.id)).catch(() => {})
    }
  }
  const updated = projects.filter((p) => p.id !== projectId)
  $projects.set(updated)
  IPC.saveProjects(updated)
}

export function removeTab(projectId: string, tabId: string): void {
  IPC.closeTab(makeTabKey(projectId, tabId)).catch(() => {})
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
    id: `${label}-${randomSuffix()}`,
    label,
    cmd: '',
    pinned: false,
  }
  const updated = projects.map((p) =>
    p.id !== projectId ? p : { ...p, tabs: [...p.tabs, newTab] },
  )
  $projects.set(updated)
  IPC.saveProjects(updated)
  return newTab
}

export function addProject(name: string, path: string): Project {
  const id = `${slugify(name)}-${randomSuffix()}`
  const project: Project = {
    id,
    name: name.trim(),
    path: path.trim(),
    pinned: false,
    tabs: [{ id: 'shell', label: 'shell', cmd: '', pinned: false }],
  }
  const updated = [...$projects.get(), project]
  $projects.set(updated)
  $expanded.set({ ...$expanded.get(), [id]: true })
  IPC.saveProjects(updated)
  return project
}

export function renameProject(projectId: string, newName: string): void {
  const updated = $projects
    .get()
    .map((p) => (p.id === projectId ? { ...p, name: newName.trim() } : p))
  $projects.set(updated)
  IPC.saveProjects(updated)
}

export function renameTab(
  projectId: string,
  tabId: string,
  newLabel: string,
): void {
  const updated = $projects.get().map((p) => {
    if (p.id !== projectId) return p
    return {
      ...p,
      tabs: p.tabs.map((t) =>
        t.id === tabId ? { ...t, label: newLabel.trim() } : t,
      ),
    }
  })
  $projects.set(updated)
  IPC.saveProjects(updated)
}

export function updateTabCwd(tabKey: string, cwd: string): void {
  const [projectId, tabId] = tabKey.split(':')
  if (!projectId || !tabId) return
  const updated = $projects.get().map((p) => {
    if (p.id !== projectId) return p
    return {
      ...p,
      tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, lastCwd: cwd } : t)),
    }
  })
  $projects.set(updated)
  IPC.saveProjects(updated)
}
