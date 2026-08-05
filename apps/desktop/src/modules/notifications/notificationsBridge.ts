/**
 * Notifications bridge — TS↔Rust signal pump.
 *
 * Notification firing lives entirely in Rust (`NotificationService`). The
 * frontend's only job is to push three pieces of UI state to the backend
 * so it can apply suppression decisions on its own:
 *
 * - **Projects map** (`set_projects`) — for resolving `project_id → project_name`
 *   in notification titles. Pushed on every `$projects` change.
 * - **Active tab** (`set_active_tab`) — composite `<projectId>:<tabId>`,
 *   or `null` if no project is active. Pushed on every navigation change.
 * - **App focus** (`set_app_focus`) — whether the agent-terminal window is
 *   the OS-frontmost app. Pushed on window focus/blur.
 *
 * Plus the click listener: when Rust emits `notification:click`, navigate
 * to the indicated tab.
 *
 * ## Agent-agnosticism
 *
 * This file does not know any specific agents exist. It pushes opaque
 * project/tab/focus signals and routes opaque click events. Adding a new
 * agent mod requires zero changes here. The architecture-conformance test
 * (`architecture.test.ts`) greps this directory for forbidden strings to
 * enforce the constraint.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import {
  $activeProjectId,
  $activeTabId,
  navigateToTab,
} from '@/modules/stores/$navigation'
import { $projects } from '@/modules/stores/$projects'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'

let started = false

export function startNotificationsBridge(): void {
  if (started) return
  started = true

  // Push projects whenever they change. The backend uses this only to
  // resolve project names for notification titles — we send only the
  // minimum needed (id + name).
  $projects.listen((projects) => {
    void invoke('notif_set_projects', {
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
    }).catch(() => {})
  })
  // Initial push for the projects already loaded at boot.
  void invoke('notif_set_projects', {
    projects: $projects.get().map((p) => ({ id: p.id, name: p.name })),
  }).catch(() => {})

  // Push the composite tab id whenever the active tab changes. Backend uses
  // this to apply the foreground+active-tab suppression rule.
  function pushActiveTab(): void {
    const projectId = $activeProjectId.get()
    const tabId = projectId ? $activeTabId.get()[projectId] : undefined
    const composite = projectId && tabId ? makeTabKey(projectId, tabId) : null
    void invoke('notif_set_active_tab', { tabId: composite }).catch(() => {})
  }
  $activeProjectId.listen(pushActiveTab)
  $activeTabId.listen(pushActiveTab)
  pushActiveTab()

  // Window focus state — backend uses this for suppression and to drive
  // its click-routing heuristic on focus events.
  function pushFocus(focused: boolean): void {
    void invoke('notif_set_app_focus', { focused }).catch(() => {})
  }
  if (typeof window !== 'undefined') {
    pushFocus(document.hasFocus())
    window.addEventListener('focus', () => pushFocus(true))
    window.addEventListener('blur', () => pushFocus(false))
  }

  // Click routing: backend posts `notification:click` when the user clicks
  // an OS notification. Navigate to the indicated tab.
  void listen<{ project_id: string; tab_id: string }>(
    'notification:click',
    (event) => {
      const { project_id, tab_id } = event.payload
      if (!project_id || !tab_id) return
      navigateToTab(project_id, tab_id)
    },
  )
}
