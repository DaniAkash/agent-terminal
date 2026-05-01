import { listen } from '@tauri-apps/api/event'
import {
  type AgentTurnState,
  clearTabMeta,
  type GitInfo,
  type ProcessInfo,
  type TabStatus,
  type TabType,
  updateTabMeta,
} from '@/modules/stores/$tabMeta'

type ModEventPayload = {
  /** Composite `${projectId}:${tabId}` key — the Rust side names this `tabId`
   *  on the wire, but it is what React calls a tabKey (see makeTabKey). */
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

function dispatch({
  tabId: tabKey,
  modId: _modId,
  event,
  data,
}: ModEventPayload): void {
  // Guard against malformed payloads — Rust controls the emitter, but a
  // bad payload should never crash the global listener.
  if (data !== null && data !== undefined && typeof data !== 'object') return
  switch (event) {
    case 'status_changed': {
      const { status, exitCode } = data as {
        status: TabStatus
        exitCode?: number
      }
      updateTabMeta(tabKey, { status, exitCode })
      break
    }
    case 'tab_type_changed': {
      const { type, agent, cmd } = data as {
        type: TabType
        agent?: string
        cmd?: string
      }
      if (type === 'shell') {
        updateTabMeta(tabKey, {
          type,
          agentName: undefined,
          agentCmd: undefined,
          // Clear hook-driven state when the agent process exits.
          agentState: undefined,
          agentMessage: undefined,
        })
      } else {
        updateTabMeta(tabKey, { type, agentName: agent, agentCmd: cmd })
      }
      break
    }
    case 'cwd_changed': {
      const { cwd } = data as { cwd: string }
      updateTabMeta(tabKey, { cwd })
      break
    }
    case 'git_info': {
      updateTabMeta(tabKey, { git: (data as GitInfo) ?? undefined })
      break
    }
    case 'process_info': {
      const { processes } = data as { processes: ProcessInfo[] }
      const ports = processes.flatMap((p) => p.listeningPorts ?? [])
      updateTabMeta(tabKey, {
        processes,
        listeningPorts: [...new Set(ports)],
      })
      break
    }
    case 'listening_ports': {
      const { ports } = data as { ports: number[] }
      updateTabMeta(tabKey, { listeningPorts: ports })
      break
    }
    case 'agent_state_changed': {
      const { state, message } = data as {
        state: AgentTurnState
        message?: string
      }
      updateTabMeta(tabKey, {
        agentState: state,
        agentMessage: message ?? undefined,
      })
      break
    }
    case 'closed': {
      // EchoMod fires this — used to GC stale tabMeta entries on tab close.
      clearTabMeta(tabKey)
      break
    }
  }
}
