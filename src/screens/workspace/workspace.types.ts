export type Tab = {
  id: string
  label: string
  cmd: string
  pinned: boolean
  lastCwd?: string
}

export type Project = {
  id: string
  name: string
  path: string
  tabs: Tab[]
  pinned: boolean
}
