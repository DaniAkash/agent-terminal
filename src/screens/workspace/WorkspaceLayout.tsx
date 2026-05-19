import { useStore } from '@nanostores/react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Sidebar } from '@/components/Sidebar/Sidebar'
import { StatusBar } from '@/components/StatusBar/StatusBar'
import { TabSwitcher } from '@/components/TabSwitcher/TabSwitcher'
import { TerminalSearchBar } from '@/components/TerminalSearchBar/TerminalSearchBar'
import { formatDropPayload } from '@/modules/dragDrop/dropPayload'
import { Keys, Mod } from '@/modules/keymap/keys'
import { $activeSearch, openSearch } from '@/modules/stores/$activeSearch'
import { getActiveTerminalHandle } from '@/modules/stores/$activeTerminal'
import { popClosedTab } from '@/modules/stores/$closedTabs'
import {
  decreaseFontSize,
  increaseFontSize,
  resetFontSize,
} from '@/modules/stores/$fontSize'
import { $metaHeld } from '@/modules/stores/$keyboard'
import {
  $activeProjectId,
  $activeTabId,
  navigateToProject,
  navigateToTab,
  onTabRemoved,
  openNewTabInProject,
} from '@/modules/stores/$navigation'
import {
  $projects,
  addTab,
  removeTab,
  restoreTabLabel,
} from '@/modules/stores/$projects'
import { WorkspaceView } from '@/screens/workspace/WorkspaceView'

/* ---------------------------------------------------------------------------
 * WorkspaceLayout
 * -------------------------------------------------------------------------*/

export function WorkspaceLayout() {
  const projects = useStore($projects)
  const activeProjectId = useStore($activeProjectId)

  // Lazy-mount projects: only render WorkspaceView once a project becomes active.
  // Already-mounted projects stay rendered and are CSS-hidden when inactive.
  const [mountedProjects, setMountedProjects] = useState<Set<string>>(
    () => new Set(activeProjectId ? [activeProjectId] : []),
  )

  useEffect(() => {
    if (activeProjectId) {
      setMountedProjects((prev) => {
        if (prev.has(activeProjectId)) return prev
        return new Set([...prev, activeProjectId])
      })
    }
  }, [activeProjectId])

  // Recovery: if the active project was removed, fall back to the first remaining one.
  useEffect(() => {
    const exists = projects.some((p) => p.id === activeProjectId)
    if (!exists && projects.length > 0) {
      navigateToProject(projects[0].id)
    }
  }, [projects, activeProjectId])

  // Track whether Cmd is physically held so the sidebar can show project-number
  // badges. The blur listener resets the flag if the window loses focus while
  // Cmd is held — prevents the overlay from getting stuck.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Meta') $metaHeld.set(true)
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Meta') $metaHeld.set(false)
    }
    function onBlur() {
      $metaHeld.set(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // File drag-drop — Tauri 2 captures the OS drop at the window level
  // (default `dragDropEnabled: true`) and emits a JS event. On `drop` we
  // shell-quote the paths and paste them into the active terminal's PTY.
  //
  // `pasteToPty` (not `sendToPty`) wraps the payload in bracketed paste
  // markers if the running app enabled them — Claude Code / Codex use
  // that signal to distinguish paste from typed input and auto-attach
  // image paths as [image] instead of inserting them as raw text.
  useEffect(() => {
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return
      const payload = formatDropPayload(event.payload.paths)
      if (!payload) return
      // No active terminal (e.g. no projects open yet) — drop silently.
      // Same posture as the other global handlers.
      getActiveTerminalHandle()?.pasteToPty(payload)
    })
    return () => {
      unlistenPromise.then((fn) => fn()).catch(() => {})
    }
  }, [])

  // enableOnFormTags is required because xterm uses a hidden <textarea> to
  // capture keyboard input. Without it react-hotkeys-hook silently ignores
  // all key events while the terminal has focus.
  const hotkeyOpts = { preventDefault: true, enableOnFormTags: true } as const

  // ⌘T — new tab in the active project
  useHotkeys(
    `${Mod.Meta}+${Keys.T}`,
    () => {
      openNewTabInProject($activeProjectId.get())
    },
    hotkeyOpts,
  )

  // ⌘W — close the active tab (pinned tabs are protected)
  useHotkeys(
    `${Mod.Meta}+${Keys.W}`,
    () => {
      const projectId = $activeProjectId.get()
      const tabId = $activeTabId.get()[projectId] ?? ''
      if (!tabId) return
      const project = $projects.get().find((p) => p.id === projectId)
      const tab = project?.tabs.find((t) => t.id === tabId)
      if (tab?.pinned) return
      onTabRemoved(projectId, tabId)
      removeTab(projectId, tabId)
    },
    hotkeyOpts,
  )

  // ⌘⇧] / Ctrl+Tab — next tab. Both bound: ⌘⇧] is the macOS browser/iTerm
  // consensus; Ctrl+Tab is the muscle-memory alias (Apple Terminal default,
  // VS Code, Chrome). Safe to keep on Ctrl because `Ctrl+Tab` has no
  // readline binding — `Tab` itself is shell-bound but `Ctrl+Tab` isn't.
  useHotkeys(
    [
      `${Mod.Meta}+${Mod.Shift}+${Keys.BracketRight}`,
      `${Mod.Ctrl}+${Keys.Tab}`,
    ],
    () => {
      const projectId = $activeProjectId.get()
      const project = $projects.get().find((p) => p.id === projectId)
      if (!project || project.tabs.length < 2) return
      const tabId = $activeTabId.get()[projectId]
      const idx = project.tabs.findIndex((t) => t.id === tabId)
      const next = project.tabs[(idx + 1) % project.tabs.length]
      if (next) navigateToTab(projectId, next.id)
    },
    hotkeyOpts,
  )

  // ⌘⇧[ / Ctrl+Shift+Tab — previous tab. Symmetric with next-tab above.
  useHotkeys(
    [
      `${Mod.Meta}+${Mod.Shift}+${Keys.BracketLeft}`,
      `${Mod.Ctrl}+${Mod.Shift}+${Keys.Tab}`,
    ],
    () => {
      const projectId = $activeProjectId.get()
      const project = $projects.get().find((p) => p.id === projectId)
      if (!project || project.tabs.length < 2) return
      const tabId = $activeTabId.get()[projectId]
      const idx = project.tabs.findIndex((t) => t.id === tabId)
      const prev =
        project.tabs[(idx - 1 + project.tabs.length) % project.tabs.length]
      if (prev) navigateToTab(projectId, prev.id)
    },
    hotkeyOpts,
  )

  // ⌘1–9 — switch to project N in sidebar display order (pinned first).
  // Diverges from iTerm2/Ghostty (which use Cmd+1..9 for tab N) — agent-terminal
  // is project-centric so number-jump operates at the project layer; tab nav
  // is via Cmd+Shift+]/[ cycling. Projects beyond 9 have no shortcut.
  useHotkeys(
    [
      `${Mod.Meta}+${Keys.Digit1}`,
      `${Mod.Meta}+${Keys.Digit2}`,
      `${Mod.Meta}+${Keys.Digit3}`,
      `${Mod.Meta}+${Keys.Digit4}`,
      `${Mod.Meta}+${Keys.Digit5}`,
      `${Mod.Meta}+${Keys.Digit6}`,
      `${Mod.Meta}+${Keys.Digit7}`,
      `${Mod.Meta}+${Keys.Digit8}`,
      `${Mod.Meta}+${Keys.Digit9}`,
    ],
    (e) => {
      const n = Number.parseInt(e.key, 10) - 1
      const allProjects = $projects.get()
      const ordered = [
        ...allProjects.filter((p) => p.pinned),
        ...allProjects.filter((p) => !p.pinned),
      ]
      const target = ordered[n]
      if (target) navigateToProject(target.id)
    },
    hotkeyOpts,
  )

  // ⌘= / ⌘+ — increase font size. Bound twice: bare `Equal` for ⌘= and
  // shifted `Equal` for ⌘+ (which is Shift+= on US keyboards). Both
  // presses use the same physical key (event.code "Equal") and only
  // differ by the shift modifier.
  useHotkeys(
    [`${Mod.Meta}+${Keys.Equal}`, `${Mod.Meta}+${Mod.Shift}+${Keys.Equal}`],
    () => increaseFontSize(),
    hotkeyOpts,
  )
  // ⌘- — decrease font size
  useHotkeys(`${Mod.Meta}+${Keys.Minus}`, () => decreaseFontSize(), hotkeyOpts)
  // ⌘0 — reset font size to default
  useHotkeys(`${Mod.Meta}+${Keys.Digit0}`, () => resetFontSize(), hotkeyOpts)

  // ⌘K — clear screen + scrollback in the active terminal
  useHotkeys(
    `${Mod.Meta}+${Keys.K}`,
    () => getActiveTerminalHandle()?.clear(),
    hotkeyOpts,
  )

  // ⌘A — select all in the active terminal
  useHotkeys(
    `${Mod.Meta}+${Keys.A}`,
    () => getActiveTerminalHandle()?.selectAll(),
    hotkeyOpts,
  )

  // ⌘⇧T — reopen the last closed tab in its original project
  useHotkeys(
    `${Mod.Meta}+${Mod.Shift}+${Keys.T}`,
    () => {
      const closed = popClosedTab()
      if (!closed) return
      const project = $projects.get().find((p) => p.id === closed.projectId)
      if (!project) return // project itself was deleted; drop silently
      const newTab = addTab(closed.projectId, closed.cwd)
      if (!newTab) return
      // addTab generates a fresh dedupe-safe label; restore the original
      // via restoreTabLabel so the change persists across app restart.
      // restoreTabLabel (vs renameTab) avoids setting userRenamed since
      // we're replaying the tab's prior label, not making a user edit.
      restoreTabLabel(closed.projectId, newTab.id, closed.label)
      navigateToTab(closed.projectId, newTab.id)
    },
    hotkeyOpts,
  )

  // ⌘F — open the find overlay over the active terminal
  useHotkeys(
    `${Mod.Meta}+${Keys.F}`,
    () => {
      const projectId = $activeProjectId.get()
      const tabId = $activeTabId.get()[projectId] ?? ''
      if (!tabId) return
      openSearch(`${projectId}:${tabId}`)
    },
    hotkeyOpts,
  )

  // ⌘G / ⌘⇧G — find next / previous (only meaningful while bar is open)
  useHotkeys(
    `${Mod.Meta}+${Keys.G}`,
    () => {
      if ($activeSearch.get()) getActiveTerminalHandle()?.searchNext()
    },
    hotkeyOpts,
  )
  useHotkeys(
    `${Mod.Meta}+${Mod.Shift}+${Keys.G}`,
    () => {
      if ($activeSearch.get()) getActiveTerminalHandle()?.searchPrevious()
    },
    hotkeyOpts,
  )

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="relative min-w-0 flex-1">
          {projects.map((project) => {
            if (!mountedProjects.has(project.id)) return null
            return (
              <div
                key={project.id}
                className="absolute inset-0 flex flex-col"
                style={{
                  display: project.id === activeProjectId ? 'flex' : 'none',
                }}
              >
                <WorkspaceView project={project} />
              </div>
            )
          })}
          {/* Find-in-scrollback overlay floats over the active terminal,
              regardless of which project/tab is visible. */}
          <TerminalSearchBar />
        </div>
      </div>
      <StatusBar />
      {/* Self-contained: owns its open state + Cmd+P hotkey. */}
      <TabSwitcher />
    </div>
  )
}
