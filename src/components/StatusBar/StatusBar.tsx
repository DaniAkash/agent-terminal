import { useStore } from '@nanostores/react'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'

export function StatusBar() {
  const projects = useStore($projects)
  const allTabMeta = useStore($tabMeta)
  const sessionsRunning = projects.reduce(
    (n, p) =>
      n +
      p.tabs.filter(
        (t) => allTabMeta[makeTabKey(p.id, t.id)]?.status === 'running',
      ).length,
    0,
  )

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
