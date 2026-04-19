import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'
import { $projects } from '@/modules/stores/$projects'

/* ---------------------------------------------------------------------------
 * Sub-components — kept private to this module
 * -------------------------------------------------------------------------*/
function StatusBar({ sessionsRunning }: { sessionsRunning: number }) {
  return (
    <div
      className="flex h-6 shrink-0 items-center border-t px-3 text-[11px]"
      style={{
        background: 'var(--status-bar-background)',
        borderColor: 'var(--status-bar-border)',
        color: 'var(--status-bar-foreground)',
      }}
    >
      <span className="mr-auto">
        {sessionsRunning > 0 ? `● ${sessionsRunning} running` : '○ idle'}
      </span>
      <span className="opacity-60">UTF-8 · zsh</span>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * WorkspaceLayout
 * -------------------------------------------------------------------------*/
export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const projects = useStore($projects)
  const sessionsRunning = projects.reduce(
    (n, p) => n + p.tabs.filter((t) => t.running).length,
    0,
  )

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-black/90 p-6">
      <div
        className="relative flex flex-col overflow-hidden"
        style={{
          width: 'min(1280px, 100%)',
          height: 'min(820px, 100%)',
          borderRadius: 11,
          background: 'var(--background)',
          boxShadow: 'var(--window-shadow)',
          border: '0.5px solid var(--window-border)',
        }}
      >
        {/* macOS traffic-lights drag region overlay */}
        <div
          className="pointer-events-none absolute top-0 left-0 z-10 h-[38px]"
          style={{ width: 232, WebkitAppRegion: 'drag' } as React.CSSProperties}
        />

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Sidebar placeholder — PR 2 fills this in */}
          <div
            className="flex h-full w-[232px] min-w-[232px] flex-col border-r"
            style={{
              background: 'var(--sidebar-background)',
              borderColor: 'var(--sidebar-border)',
            }}
          >
            {/* Sidebar header (reserves traffic-light space) */}
            <div
              className="flex h-[38px] shrink-0 items-center border-b px-3 pl-[78px] font-medium text-[12px]"
              style={{
                borderColor: 'var(--sidebar-border)',
                color: 'var(--sidebar-foreground)',
                letterSpacing: '0.01em',
              }}
            >
              Workspaces
            </div>
            <div
              className="flex-1 overflow-y-auto py-1.5 text-[12.5px]"
              style={{ color: 'var(--sidebar-foreground)' }}
            >
              {projects.map((p) => (
                <div
                  key={p.id}
                  className="mx-1.5 flex h-[26px] items-center gap-1.5 rounded-md px-3 opacity-60"
                >
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Main content */}
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>

        <StatusBar sessionsRunning={sessionsRunning} />
      </div>
    </div>
  )
}
