export type Tab = {
  id: string
  /**
   * Deduplication key and display name.
   * When `userRenamed` is true this is always shown as-is.
   * When `userRenamed` is absent/false the UI derives the display label from
   * the tab's live CWD instead (see `resolveTabLabel`).
   */
  label: string
  cmd: string
  pinned: boolean
  lastCwd?: string
  /** True once the user has explicitly renamed this tab via the inline editor. */
  userRenamed?: boolean
}

export type Project = {
  id: string
  name: string
  path: string
  tabs: Tab[]
  pinned: boolean
}
