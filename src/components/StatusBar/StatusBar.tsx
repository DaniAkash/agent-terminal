import { StatusBarLeft } from '@/components/StatusBar/StatusBarLeft'
import { StatusBarRight } from '@/components/StatusBar/StatusBarRight'

/**
 * Status bar — V1 Extended: full-length split (general · session).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  /cwd  branch*  ● N  claude N  codex N  🤘  ····  name · pid · mem · :port │
 * │  └────── StatusBarLeft (workspace) ───────┘  └── StatusBarRight (session) ┘│
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Left  — workspace state: active tab CWD, git branch, global running counts,
 *          per-agent counts, danger indicator.
 * Right — active session: live process metadata for the focused tab (name,
 *          pid, elapsed, memory, ports, model, danger).
 *
 * Each side renders null when it has nothing to show, so the bar degrades
 * gracefully on fresh tabs with no data yet.
 */
export function StatusBar() {
  return (
    <div
      className="flex h-6 shrink-0 items-center gap-2 overflow-hidden border-t px-3 text-[11px]"
      style={{
        background: 'var(--status-bar-background)',
        borderColor: 'var(--status-bar-border)',
        color: 'var(--status-bar-foreground)',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <StatusBarLeft />
      <StatusBarRight />
    </div>
  )
}
