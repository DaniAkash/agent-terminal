import { useStore } from '@nanostores/react'
import type React from 'react'
import { hasDangerFlag } from '@/components/agent.helpers'
import { DangerBadge } from '@/components/DangerBadge'
import { RunningDot } from '@/components/RunningDot'
import { $activeProjectId, $activeTabId } from '@/modules/stores/$navigation'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta, type TabMeta } from '@/modules/stores/$tabMeta'
import {
  cwdBasename,
  MONO_FONT,
  makeTabKey,
} from '@/screens/workspace/workspace.helpers'
import type { Project } from '@/screens/workspace/workspace.types'

/* ---------------------------------------------------------------------------
 * StatusBarLeft — workspace / general state
 *
 * Shows the active tab's CWD and git context, plus global counts across
 * every tab in every project.
 *
 * Layout (items only rendered when non-zero / available):
 *
 *   /cwd-basename  branch*+N  ● N  claude N  codex N  🤘
 *   │              │          │    │          │         └─ any agent running with a danger flag
 *   │              │          │    │          └─────────── running codex sessions (global)
 *   │              │          │    └────────────────────── running claude sessions (global)
 *   │              │          └─────────────────────────── running shell count (global)
 *   │              └────────────────────────────────────── git branch + dirty (*) + ahead (+N)
 *   └───────────────────────────────────────────────────── CWD basename of active tab
 *
 * Items are separated by a dim mid-dot (·).
 * -------------------------------------------------------------------------*/

type WorkspaceCounts = {
  shellRunning: number
  claudeRunning: number
  codexRunning: number
  anyDanger: boolean
}

/**
 * Scans all tabs across all projects and returns aggregate running counts.
 * Uses flatMap + filter to keep cyclomatic complexity low.
 */
function computeWorkspaceCounts(
  projects: Project[],
  allTabMeta: Record<string, TabMeta>,
): WorkspaceCounts {
  // Flatten to a single array of defined TabMeta values.
  const metas = projects
    .flatMap((p) => p.tabs.map((t) => allTabMeta[makeTabKey(p.id, t.id)]))
    .filter((m): m is TabMeta => m !== undefined)

  return {
    shellRunning: metas.filter(
      (m) => m.type === 'shell' && m.status === 'running',
    ).length,
    claudeRunning: metas.filter(
      (m) =>
        m.type === 'agent' &&
        m.status === 'running' &&
        m.agentName === 'claude-code',
    ).length,
    codexRunning: metas.filter(
      (m) =>
        m.type === 'agent' && m.status === 'running' && m.agentName === 'codex',
    ).length,
    anyDanger: metas.some(
      (m) => m.type === 'agent' && hasDangerFlag(m.agentCmd),
    ),
  }
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

/** Thin separator dot between status bar items. */
function Dot() {
  return (
    <span aria-hidden="true" style={{ opacity: 0.3 }}>
      ·
    </span>
  )
}

export function StatusBarLeft() {
  const projects = useStore($projects)
  const allTabMeta = useStore($tabMeta)
  const activeProjectId = useStore($activeProjectId)
  const activeTabIds = useStore($activeTabId)

  // Active tab context for CWD + git
  const activeTabId = activeTabIds[activeProjectId] ?? ''
  const activeMeta = activeTabId
    ? allTabMeta[makeTabKey(activeProjectId, activeTabId)]
    : undefined

  const cwdDisplay = activeMeta?.cwd ? cwdBasename(activeMeta.cwd) : null
  const git = activeMeta?.git
  const { shellRunning, claudeRunning, codexRunning, anyDanger } =
    computeWorkspaceCounts(projects, allTabMeta)

  const items: React.ReactNode[] = []

  if (cwdDisplay) {
    items.push(
      <span key="cwd" style={{ fontFamily: MONO_FONT }}>
        {cwdDisplay}
      </span>,
    )
  }

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

  if (shellRunning > 0) {
    items.push(
      <span key="shells" className="flex items-center gap-1">
        <RunningDot />
        {shellRunning}
      </span>,
    )
  }

  if (claudeRunning > 0) {
    items.push(
      <span key="claude" className="flex items-center gap-1">
        <RunningDot />
        <span style={{ fontFamily: MONO_FONT }}>claude {claudeRunning}</span>
      </span>,
    )
  }

  if (codexRunning > 0) {
    items.push(
      <span key="codex" className="flex items-center gap-1">
        <RunningDot />
        <span style={{ fontFamily: MONO_FONT }}>codex {codexRunning}</span>
      </span>,
    )
  }

  if (anyDanger) {
    items.push(<DangerBadge key="danger" size={10} />)
  }

  if (items.length === 0) return null

  return (
    <div className="mr-auto flex min-w-0 items-center gap-1.5 overflow-hidden">
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
