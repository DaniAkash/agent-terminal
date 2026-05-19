import { useStore } from '@nanostores/react'
import type React from 'react'
import { RunningDot } from '@/components/RunningDot'
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta, type TabMeta } from '@/modules/stores/$tabMeta'
import { MONO_FONT, makeTabKey } from '@/screens/workspace/workspace.helpers'
import type { Project } from '@/screens/workspace/workspace.types'

/* ---------------------------------------------------------------------------
 * StatusBarLeft — workspace overview
 *
 * Always renders the <ThemeToggle> so users can reach it even on idle
 * workspaces. Aggregate metric items only appear when non-zero.
 *
 * Layout:
 *
 *   🌓  ● N active agents  ·  ● X active tasks  ·  Y failed tasks
 *   │   │                      │                    │
 *   │   │                      │                    └── tabs in error state
 *   │   │                      └───────────────────── shell tabs running
 *   │   └──────────────────────────────────────────── claude + codex running
 *   └── ThemeToggle (always visible)
 *
 * Items are separated by a dim mid-dot (·).
 * -------------------------------------------------------------------------*/

type WorkspaceCounts = {
  agentsRunning: number
  tasksRunning: number
  tasksFailed: number
}

function computeWorkspaceCounts(
  projects: Project[],
  allTabMeta: Record<string, TabMeta>,
): WorkspaceCounts {
  const metas = projects
    .flatMap((p) => p.tabs.map((t) => allTabMeta[makeTabKey(p.id, t.id)]))
    .filter((m): m is TabMeta => m !== undefined)

  return {
    agentsRunning: metas.filter(
      (m) => m.type === 'agent' && m.status === 'running',
    ).length,
    tasksRunning: metas.filter(
      (m) => m.type === 'shell' && m.status === 'running',
    ).length,
    tasksFailed: metas.filter((m) => m.status === 'error').length,
  }
}

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

  const { agentsRunning, tasksRunning, tasksFailed } = computeWorkspaceCounts(
    projects,
    allTabMeta,
  )

  const items: React.ReactNode[] = []

  if (agentsRunning > 0) {
    items.push(
      <span key="agents" className="flex items-center gap-1">
        <RunningDot />
        <span style={{ fontFamily: MONO_FONT }}>
          {agentsRunning} active {agentsRunning === 1 ? 'agent' : 'agents'}
        </span>
      </span>,
    )
  }

  if (tasksRunning > 0) {
    items.push(
      <span key="tasks" className="flex items-center gap-1">
        <RunningDot />
        <span style={{ fontFamily: MONO_FONT }}>
          {tasksRunning} active {tasksRunning === 1 ? 'task' : 'tasks'}
        </span>
      </span>,
    )
  }

  if (tasksFailed > 0) {
    items.push(
      <span
        key="failed"
        style={{ fontFamily: MONO_FONT, color: 'var(--terminal-red)' }}
      >
        {tasksFailed} failed {tasksFailed === 1 ? 'task' : 'tasks'}
      </span>,
    )
  }

  return (
    <div className="mr-auto flex min-h-6 min-w-0 items-center gap-1.5 overflow-hidden">
      <ThemeToggle />
      {items.length > 0 && (
        <>
          <Dot />
          {items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static order, no reordering
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <Dot />}
              {item}
            </span>
          ))}
        </>
      )}
    </div>
  )
}
