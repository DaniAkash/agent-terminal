export function StatusBar({ sessionsRunning }: { sessionsRunning: number }) {
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
