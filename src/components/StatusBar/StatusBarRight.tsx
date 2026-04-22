import { useStore } from '@nanostores/react'
import { hasDangerFlag, parseModelFlag } from '@/components/agent.helpers'
import { DangerBadge } from '@/components/DangerBadge'
import { $activeProjectId, $activeTabId } from '@/modules/stores/$navigation'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { MONO_FONT, makeTabKey } from '@/screens/workspace/workspace.helpers'

/* ---------------------------------------------------------------------------
 * StatusBarRight — active session state
 *
 * Shows runtime metadata for the currently focused tab.
 *
 * Agent tabs with live process data:
 *
 *   name · pid · elapsed · memory · :port1 :port2 · model · 🤘
 *   │      │     │         │        │                │       └── danger flag active
 *   │      │     │         │        │                └────────── --model flag value
 *   │      │     │         │        └─────────────────────────── listening TCP ports
 *   │      │     │         └──────────────────────────────────── RSS memory (MB)
 *   │      │     └────────────────────────────────────────────── wall-clock elapsed
 *   │      └──────────────────────────────────────────────────── agent process PID
 *   └─────────────────────────────────────────────────────────── agent process name
 *
 * Shell tabs / agent tabs with no process data yet:
 *
 *   status   (running / done / error — hidden when idle)
 *
 * Items are separated by a dim mid-dot (·).
 * -------------------------------------------------------------------------*/

/** Thin separator dot between status bar items. */
function Dot() {
  return (
    <span aria-hidden="true" style={{ opacity: 0.3 }}>
      ·
    </span>
  )
}

/**
 * Formats a memory value from kilobytes to a human-readable string.
 *   < 1 MB  → "NKB"
 *   < 1 GB  → "NMB"
 *   >= 1 GB → "N.NGb"   (rare for a terminal process but handled)
 */
function formatMemory(kb: number): string {
  if (kb < 1024) return `${kb}KB`
  const mb = kb / 1024
  if (mb < 1024) return `${Math.round(mb)}MB`
  return `${(mb / 1024).toFixed(1)}GB`
}

export function StatusBarRight() {
  const allTabMeta = useStore($tabMeta)
  const activeProjectId = useStore($activeProjectId)
  const activeTabIds = useStore($activeTabId)

  const activeTabId = activeTabIds[activeProjectId] ?? ''
  const meta = activeTabId
    ? allTabMeta[makeTabKey(activeProjectId, activeTabId)]
    : undefined

  if (!meta) return null

  const { type, status, agentCmd, processes, listeningPorts } = meta

  // ── Agent tab with live process data ─────────────────────────────────────
  const proc = processes?.[0]
  if (type === 'agent' && proc) {
    const model = parseModelFlag(agentCmd)
    const ports = listeningPorts ?? []
    const isDanger = hasDangerFlag(agentCmd)

    const items: React.ReactNode[] = [
      <span key="name" style={{ fontFamily: MONO_FONT }}>
        {proc.name}
      </span>,
      <span key="pid" style={{ fontFamily: MONO_FONT, opacity: 0.6 }}>
        {proc.pid}
      </span>,
      <span key="elapsed" style={{ fontFamily: MONO_FONT }}>
        {proc.elapsedTime}
      </span>,
      <span key="mem" style={{ fontFamily: MONO_FONT }}>
        {formatMemory(proc.memoryKb)}
      </span>,
    ]

    if (ports.length > 0) {
      items.push(
        <span
          key="ports"
          style={{ fontFamily: MONO_FONT }}
          className="text-accent opacity-80"
        >
          {ports.map((p) => `:${p}`).join(' ')}
        </span>,
      )
    }

    if (model) {
      items.push(
        <span
          key="model"
          style={{ fontFamily: MONO_FONT }}
          className="opacity-60"
        >
          {model}
        </span>,
      )
    }

    if (isDanger) {
      items.push(<DangerBadge key="danger" size={10} />)
    }

    return (
      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 overflow-hidden">
        {items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static order, no reordering
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <Dot />}
            {item}
          </span>
        ))}
      </div>
    )
  }

  // ── Shell tab or agent with no process data yet ───────────────────────────
  // Only show when there's something interesting to say (not idle).
  if (status === 'idle') return null

  const statusLabel: Record<string, string> = {
    running: 'running',
    done: 'done',
    error: 'error',
  }
  const label = statusLabel[status]
  if (!label) return null

  const statusColor: Record<string, string> = {
    running: 'var(--terminal-green)',
    done: 'var(--terminal-green)',
    error: 'var(--terminal-red)',
  }

  return (
    <div className="ml-auto flex shrink-0 items-center">
      <span style={{ fontFamily: MONO_FONT, color: statusColor[status] }}>
        {label}
      </span>
    </div>
  )
}
