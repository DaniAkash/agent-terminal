import { useStore } from '@nanostores/react'
import type React from 'react'
import { parseModelFlag } from '@/components/agent.helpers'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { $activeProjectId, $activeTabId } from '@/modules/stores/$navigation'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import {
  cwdBasename,
  MONO_FONT,
  makeTabKey,
} from '@/screens/workspace/workspace.helpers'

/* ---------------------------------------------------------------------------
 * StatusBarRight — active session state
 *
 * Shows runtime metadata for the currently focused tab. The rich view fires
 * for ANY tab type that has live process data — the gate is `proc != null`,
 * not `type === 'agent'`. Today only agent tabs populate `processes` via
 * ProcessInspectorMod, but the component stays type-agnostic so it will
 * automatically work for any future tab type that provides process data.
 *
 * CWD and git are always appended when available, regardless of proc data.
 *
 * Tab with live process data (currently agent tabs only):
 *
 *   name · pid · elapsed · memory · :port1 :port2 · model · branch · /cwd
 *   │      │     │         │        │                │       │         │
 *   │      │     │         │        │                │       │         └── CWD basename (tooltip = full path)
 *   │      │     │         │        │                │       └─────────── git branch + dirty (*) + ahead (+N)
 *   │      │     │         │        │                └─────────────────── --model flag value
 *   │      │     │         │        └──────────────────────────────────── listening TCP ports
 *   │      │     │         └───────────────────────────────────────────── RSS memory (MB)
 *   │      │     └─────────────────────────────────────────────────────── wall-clock elapsed
 *   │      └───────────────────────────────────────────────────────────── process PID
 *   └──────────────────────────────────────────────────────────────────── process name
 *
 * Tab with no process data (shell tabs, or agent tabs before first poll):
 *
 *   status · branch · /cwd   (status hidden when idle)
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

/** Formats git info into a compact `branch*+N-N` string. */
function formatGitLabel(git: {
  branch: string
  isDirty: boolean
  aheadBy: number
  behindBy: number
}): string {
  const dirty = git.isDirty ? '*' : ''
  const ahead = git.aheadBy > 0 ? `+${git.aheadBy}` : ''
  const behind = git.behindBy > 0 ? `-${git.behindBy}` : ''
  return `${git.branch}${dirty}${ahead}${behind}`
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

  const { status, agentCmd, processes, listeningPorts, cwd, git } = meta

  const items: React.ReactNode[] = []

  // ── Any tab with live process data ───────────────────────────────────────
  // Gate on proc being present, not on tab type, so this works for any tab
  // type that populates `processes` in the future.
  const proc = processes?.[0]
  if (proc) {
    const model = parseModelFlag(agentCmd)
    const ports = listeningPorts ?? []

    items.push(
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
    )

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
  } else if (status !== 'idle') {
    // ── Tab with no process data yet — show status text ───────────────────
    const statusColor: Record<string, string> = {
      running: 'var(--terminal-green)',
      done: 'var(--terminal-green)',
      error: 'var(--terminal-red)',
    }
    const label: Record<string, string> = {
      running: 'running',
      done: 'done',
      error: 'error',
    }
    if (label[status]) {
      items.push(
        <span
          key="status"
          style={{ fontFamily: MONO_FONT, color: statusColor[status] }}
        >
          {label[status]}
        </span>,
      )
    }
  }

  // ── Git branch — always shown when available (second from right) ─────────
  if (git?.branch) {
    items.push(
      <span
        key="git"
        className="text-accent opacity-80"
        style={{ fontFamily: MONO_FONT }}
      >
        {formatGitLabel(git)}
      </span>,
    )
  }

  // ── CWD — always shown when available (rightmost), full path on hover ────
  if (cwd) {
    items.push(
      <TooltipProvider key="cwd">
        <Tooltip>
          <TooltipTrigger
            className="cursor-default appearance-none border-0 bg-transparent p-0 text-[11px] text-inherit"
            style={{ fontFamily: MONO_FONT }}
          >
            {cwdBasename(cwd)}
          </TooltipTrigger>
          <TooltipContent side="top">{cwd}</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )
  }

  if (items.length === 0) return null

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
