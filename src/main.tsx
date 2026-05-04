import React from 'react'
import ReactDOM from 'react-dom/client'
import { IPC } from '@/modules/ipc/commands'
import { startCwdPersist } from '@/modules/mods/cwd-persist'
import { startModListener } from '@/modules/mods/mod-listener'
import { startNotificationsBridge } from '@/modules/notifications/notificationsBridge'
import { syncNotificationsEnabledToBackend } from '@/modules/notifications/preferences'
import { initNavigation } from '@/modules/stores/$navigation'
import { $projects } from '@/modules/stores/$projects'
import { WorkspaceLayout } from '@/screens/workspace/WorkspaceLayout'
import type { Project } from '@/screens/workspace/workspace.types'
import '@xterm/xterm/css/xterm.css'
import './index.css'

async function bootstrap() {
  // Start MOD event listener before render so no events are missed.
  await startModListener()

  // Debounced CWD write-back: persists tab.lastCwd on every directory change.
  startCwdPersist()

  try {
    const saved = (await IPC.listProjects()) as Project[]
    if (saved.length > 0) {
      $projects.set(saved)
    }
  } catch {
    // No saved projects — start with empty state.
  }

  initNavigation()

  // Notification firing lives entirely in Rust. The bridge just pushes
  // UI state (projects map, active tab, app focus) so the backend can
  // make suppression decisions, plus listens for click events.
  startNotificationsBridge()
  syncNotificationsEnabledToBackend()

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <WorkspaceLayout />
    </React.StrictMode>,
  )
}

bootstrap()
