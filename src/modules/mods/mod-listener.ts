import { listen } from '@tauri-apps/api/event'
import {
  type ClaudeSession,
  type CodexSession,
  clearTabMeta,
  type GitInfo,
  type TabStatus,
  type TabType,
  updateTabMeta,
} from '@/modules/stores/$tabMeta'

type ModEventPayload = {
  tabId: string
  modId: string
  event: string
  data: unknown
}

/**
 * Starts listening for `mod:event` events from the Rust MOD engine and
 * dispatches them into `$tabMeta`. Call once during app bootstrap, before render.
 *
 * Returns an unlisten function — call it to stop listening (e.g. in tests).
 */
export async function startModListener(): Promise<() => void> {
  return listen<ModEventPayload>('mod:event', (e) => {
    dispatch(e.payload)
  })
}

function dispatch({ tabId, event, data }: ModEventPayload): void {
  switch (event) {
    case 'status_changed': {
      const { status, exitCode } = data as {
        status: TabStatus
        exitCode?: number
      }
      updateTabMeta(tabId, { status, exitCode })
      break
    }
    case 'tab_type_changed': {
      const { type, agent } = data as { type: TabType; agent?: string }
      updateTabMeta(tabId, { type, agentName: agent })
      break
    }
    case 'cwd_changed': {
      const { cwd } = data as { cwd: string }
      updateTabMeta(tabId, { cwd })
      break
    }
    case 'git_info': {
      updateTabMeta(tabId, { git: (data as GitInfo) ?? undefined })
      break
    }
    case 'claude_session': {
      updateTabMeta(tabId, { claudeSession: data as ClaudeSession })
      break
    }
    case 'claude_session_cleared': {
      updateTabMeta(tabId, {
        claudeSession: undefined,
        agentName: undefined,
        type: 'shell',
      })
      break
    }
    case 'codex_session': {
      updateTabMeta(tabId, { codexSession: data as CodexSession })
      break
    }
    case 'codex_session_cleared': {
      updateTabMeta(tabId, {
        codexSession: undefined,
        agentName: undefined,
        type: 'shell',
      })
      break
    }
    case 'listening_ports': {
      const { ports } = data as { ports: number[] }
      updateTabMeta(tabId, { listeningPorts: ports })
      break
    }
    case 'closed': {
      // EchoMod fires this — used to GC stale tabMeta entries on tab close.
      clearTabMeta(tabId)
      break
    }
  }
}
