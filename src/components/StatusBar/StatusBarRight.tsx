import { useStore } from '@nanostores/react'
import {
  Download,
  FolderOpen,
  GitBranch,
  MemoryStick,
  Plug,
  Sparkles,
  Timer,
  Upload,
} from 'lucide-react'
import type React from 'react'
import { parseModelFlag } from '@/components/agent.helpers'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { $activeProjectId, $activeTabId } from '@/modules/stores/$navigation'
import {
  $tabMeta,
  type GitInfo,
  type ProcessInfo,
} from '@/modules/stores/$tabMeta'
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
 *   name · pid · ⏱ elapsed · 🧮 memory · 🔌 :port1 :port2 · ✨ model · ⎇ branch [●] [↑N] [↓N] · 📂 /cwd
 *   │      │                                                              │                              │
 *   │      │                                                              │                              └── FolderOpen + CWD basename (tooltip = full path)
 *   │      │                                                              └─────────────────────────────── GitBranch + name; ● if dirty; Upload N if ahead; Download N if behind
 *   │      └──────────────────────────────────────────────────────────────────────────────────────────── process PID (no icon — self-describing number)
 *   └─────────────────────────────────────────────────────────────────────────────────────────────────── process name (no icon — agent name is already a label)
 *
 * Tab with no process data (shell tabs, or agent tabs before first poll):
 *
 *   status · ⎇ branch [●] [↑N] [↓N] · 📂 /cwd   (status hidden when idle)
 *
 * Icon sizing: size=10, strokeWidth=1.5 — visually balanced against 11px mono text.
 * Icon opacity: matches the opacity of the adjacent text item.
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

/**
 * Builds the list of items shown when the tab has live process data.
 * Extracted to keep StatusBarRight's cognitive complexity under the lint limit.
 *
 * Always includes: name, pid, elapsed (Timer icon), memory (MemoryStick icon).
 * Conditionally includes: ports (Plug icon), model (Sparkles icon).
 */
function buildProcItems(
  proc: ProcessInfo,
  ports: number[],
  model: string | null,
): React.ReactNode[] {
  const items: React.ReactNode[] = [
    // Process name + PID: no icons — both are already self-describing labels.
    <span key="name" style={{ fontFamily: MONO_FONT }}>
      {proc.name}
    </span>,
    <span key="pid" style={{ fontFamily: MONO_FONT, opacity: 0.6 }}>
      {proc.pid}
    </span>,
    // Timer icon: elapsed wall-clock time since process started.
    <span
      key="elapsed"
      className="flex items-center gap-1"
      style={{ fontFamily: MONO_FONT }}
    >
      <Timer
        aria-hidden="true"
        size={10}
        strokeWidth={1.5}
        className="shrink-0 opacity-50"
      />
      {proc.elapsedTime}
    </span>,
    // MemoryStick icon: RSS memory usage.
    <span
      key="mem"
      className="flex items-center gap-1"
      style={{ fontFamily: MONO_FONT }}
    >
      <MemoryStick
        aria-hidden="true"
        size={10}
        strokeWidth={1.5}
        className="shrink-0 opacity-50"
      />
      {formatMemory(proc.memoryKb)}
    </span>,
  ]

  if (ports.length > 0) {
    // Plug icon: listening TCP socket.
    items.push(
      <span
        key="ports"
        className="flex items-center gap-1 text-accent opacity-80"
        style={{ fontFamily: MONO_FONT }}
      >
        <Plug
          aria-hidden="true"
          size={10}
          strokeWidth={1.5}
          className="shrink-0"
        />
        {ports.map((p) => `:${p}`).join(' ')}
      </span>,
    )
  }

  if (model) {
    // Sparkles icon: --model flag value (AI model context).
    items.push(
      <span
        key="model"
        className="flex items-center gap-1 opacity-60"
        style={{ fontFamily: MONO_FONT }}
      >
        <Sparkles
          aria-hidden="true"
          size={10}
          strokeWidth={1.5}
          className="shrink-0"
        />
        {model}
      </span>,
    )
  }

  return items
}

/**
 * Renders the git branch item with individual icons for each sync signal.
 *
 *   GitBranch icon + branch name
 *   ● (dim dot) if there are uncommitted local changes
 *   Upload icon + N if N commits ahead of remote (push needed)
 *   Download icon + N if N commits behind remote (pull needed)
 *
 * All signals are grouped inside a single flex span so they separate from
 * adjacent items with one dot, not multiple dots.
 */
function GitItem({ git }: { git: GitInfo }) {
  return (
    <span
      className="flex items-center gap-1 text-accent opacity-80"
      style={{ fontFamily: MONO_FONT }}
    >
      <GitBranch
        aria-hidden="true"
        size={10}
        strokeWidth={1.5}
        className="shrink-0"
      />
      {git.branch}
      {git.isDirty && (
        // Decorative dot signals uncommitted changes — replaces the old "*" suffix.
        <span aria-hidden="true" className="opacity-70">
          ●
        </span>
      )}
      {git.aheadBy > 0 && (
        // Upload icon: commits ahead of remote — a push is needed.
        <span className="flex items-center gap-0.5">
          <Upload
            aria-hidden="true"
            size={10}
            strokeWidth={1.5}
            className="shrink-0"
          />
          {git.aheadBy}
        </span>
      )}
      {git.behindBy > 0 && (
        // Download icon: commits behind remote — a pull is needed.
        <span className="flex items-center gap-0.5">
          <Download
            aria-hidden="true"
            size={10}
            strokeWidth={1.5}
            className="shrink-0"
          />
          {git.behindBy}
        </span>
      )}
    </span>
  )
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
    items.push(...buildProcItems(proc, ports, model))
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
    items.push(<GitItem key="git" git={git} />)
  }

  // ── CWD — always shown when available (rightmost), full path on hover ────
  // FolderOpen icon: active working directory. Tooltip reveals the full path.
  if (cwd) {
    items.push(
      <TooltipProvider key="cwd">
        <Tooltip>
          <TooltipTrigger
            className="flex cursor-default appearance-none items-center gap-1 border-0 bg-transparent p-0 text-[11px] text-inherit"
            style={{ fontFamily: MONO_FONT }}
          >
            <FolderOpen
              aria-hidden="true"
              size={10}
              strokeWidth={1.5}
              className="shrink-0 opacity-60"
            />
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
