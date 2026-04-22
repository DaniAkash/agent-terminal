import { StatusBarLeft } from '@/components/StatusBar/StatusBarLeft'
import { StatusBarRight } from '@/components/StatusBar/StatusBarRight'

/**
 * Status bar — V1 Extended: full-length split (workspace · session).
 *
 * ┌────────────────────────────────────────────────────────────────────────────────┐
 * │  ● N active agents  ● X active tasks  Y failed tasks  ····  ⎇ branch  📂 /cwd │
 * │  └──────────── StatusBarLeft (workspace overview) ─────────┘  └─ StatusBarRight┘│
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Left  — workspace overview (global across all tabs/projects):
 *          N active agents (claude + codex running) · X active tasks (shells running)
 *          · Y failed tasks (any tab in error). Renders nothing when all counts are zero.
 * Right — active tab context (switches on tab focus):
 *          process info when available (name · pid · ⏱ elapsed · 🧮 mem · 🔌 ports · ✨ model)
 *          or status text for shell tabs · then ⎇ git branch (with sync icons) · 📂 CWD basename
 *          (hover tooltip shows full path). Renders nothing for idle tabs with no data.
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
