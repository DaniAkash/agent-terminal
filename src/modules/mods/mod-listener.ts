import { listen } from '@tauri-apps/api/event'
import {
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

function formatEventData(event: string, data: unknown): string {
  if (event === 'process_info') {
    const { processes = [] } = data as { processes: Array<{
      pid: number; name: string; command: string
      cpuPercent: number; memoryKb: number; elapsedTime: string
      listeningPorts: number[]
    }> }
    if (processes.length === 0) return '  processes: (none)'
    return processes
      .map((p) =>
        `  pid=${p.pid} name=${p.name} mem=${Math.round(p.memoryKb / 1024)}MB uptime=${p.elapsedTime} ports=[${p.listeningPorts.join(',')}]\n  cmd: ${p.command}`
      )
      .join('\n')
  }
  return `  ${JSON.stringify(data)}`
}

function dispatch({ tabId, modId, event, data }: ModEventPayload): void {
  // DEBUG — log every raw mod event as it arrives (skip high-frequency timer events)
  const SILENT_EVENTS = new Set(['git_info', 'listening_ports'])
  if (!SILENT_EVENTS.has(event)) {
    console.log(`[mod:event] ${modId}/${event} | tab=${tabId}\n${formatEventData(event, data)}`)
  }

  // Guard against malformed payloads — Rust controls the emitter, but a
  // bad payload should never crash the global listener.
  if (data !== null && data !== undefined && typeof data !== 'object') return
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
      const { type, agent, cmd } = data as { type: TabType; agent?: string; cmd?: string }
      if (type === 'shell') {
        updateTabMeta(tabId, { type, agentName: undefined, agentCmd: undefined })
      } else {
        updateTabMeta(tabId, { type, agentName: agent, agentCmd: cmd })
      }
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
    case 'process_info': {
      // Enriched process scan — extract listening ports from all processes for now
      const { processes } = data as { processes: Array<{ listeningPorts: number[] }> }
      const ports = processes.flatMap((p) => p.listeningPorts ?? [])
      updateTabMeta(tabId, { listeningPorts: [...new Set(ports)] })
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
