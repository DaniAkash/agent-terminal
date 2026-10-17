import React from 'react'
import ReactDOM from 'react-dom/client'
import { IPC } from '@/modules/ipc/commands'
import { startJarvis } from '@/modules/jarvis/store'
import { startCwdPersist } from '@/modules/mods/cwd-persist'
import { startModListener } from '@/modules/mods/mod-listener'
import { startNotificationsBridge } from '@/modules/notifications/notificationsBridge'
import { syncNotificationsEnabledToBackend } from '@/modules/notifications/preferences'
import { initNavigation } from '@/modules/stores/$navigation'
import { $projects } from '@/modules/stores/$projects'
import { initSidebarViewFromStorage } from '@/modules/stores/$sidebarView'
import { initSidebarVisibleFromStorage } from '@/modules/stores/$sidebarVisible'
import {
  clampSidebarWidthToViewport,
  initSidebarWidthFromStorage,
} from '@/modules/stores/$sidebarWidth'
import { initTabRecencySubscriber } from '@/modules/stores/$tabRecency.init'
import {
  $theme,
  applyThemeToDocument,
  initThemeFromStorage,
} from '@/modules/stores/$theme'
import { installMobileOpsListener } from '@/modules/wss-bridge/mobile-ops'
import { initProjectsSync } from '@/modules/wss-bridge/projects-sync.init'
import { WorkspaceLayout } from '@/screens/workspace/WorkspaceLayout'
import type { Project } from '@/screens/workspace/workspace.types'
import '@xterm/xterm/css/xterm.css'
import './index.css'
import '@/components/Jarvis/jarvis.css'

// Suppress the webview's Inspect/Reload menu in every app window. Let events
// propagate so the app's own project and tab context menus still work.
const preventBrowserContextMenu = (event: MouseEvent) => event.preventDefault()
document.addEventListener('contextmenu', preventBrowserContextMenu)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    document.removeEventListener('contextmenu', preventBrowserContextMenu)
  })
}

async function bootstrap() {
  void startJarvis()
  await startModListener()

  startCwdPersist()

  try {
    const saved = (await IPC.listProjects()) as Project[]
    if (saved.length > 0) {
      $projects.set(saved)
    }
  } catch {}

  // Install the wss:mobile_op listener so any mobile client that fires a
  // CRUD frame (create_tab, rename_project, etc.) has a receiver on the
  // React side. Runs before ReactDOM renders so the listener is live the
  // moment the first WSS connection auth-succeeds.
  await installMobileOpsListener()

  initNavigation()
  initThemeFromStorage()
  initSidebarVisibleFromStorage()
  initSidebarViewFromStorage()
  initSidebarWidthFromStorage()

  // Re-clamp the sidebar on window resize so a width chosen on a wide
  // display cannot strand an oversized sidebar on a smaller one.
  window.addEventListener('resize', clampSidebarWidthToViewport)

  // Recency tracker subscribes to navigation; must run after initNavigation
  // so the first bump captures the project/tab restored from disk.
  initTabRecencySubscriber()

  // Pushes the project tree, merged with $tabMeta and $tabRecency, into the
  // Rust WSS cache for any paired mobile client. Its first push also flips
  // the `hydrated` flag that mobile CRUD is gated on, replacing the inline
  // bootstrap sync that used to run right after listProjects(). Must follow
  // initTabRecencySubscriber so the first push carries the restored MRU.
  initProjectsSync()

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

if (window.location.hash === '#jarvis-tray') {
  // Tray windows subscribe only to normalized usage, never workspace services.
  initThemeFromStorage()
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== 'agent-terminal:theme') return
    const theme =
      event.newValue === 'light' || event.newValue === 'dark'
        ? event.newValue
        : 'system'
    $theme.set(theme)
    applyThemeToDocument(theme)
  })
  void startJarvis()
  void import('@/components/Jarvis/JarvisTray').then(({ JarvisTray }) => {
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <JarvisTray />
      </React.StrictMode>,
    )
  })
} else {
  bootstrap()
}
