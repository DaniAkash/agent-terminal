import { useStore } from '@nanostores/react'
import { RunningDot } from '@/components/RunningDot'
import { $tabMeta } from '@/modules/stores/$tabMeta'

type Props = {
  tabId: string
}

/**
 * Replaces the static running indicator in tab pills.
 * Reads from `$tabMeta` (driven by ProcessTrackerMod + ClaudeCodeMod/CodexMod).
 *
 * - agent type + running → violet sparkle (✦) — AI agent is active
 * - agent type + idle   → dim violet sparkle — session detected, agent idle
 * - running → animated RunningDot
 * - done → green dot
 * - error → red dot
 * - idle → dim static dot
 */
export function TabStatusIcon({ tabId }: Props) {
  const allMeta = useStore($tabMeta)
  const meta = allMeta[tabId]
  const status = meta?.status ?? 'idle'
  const type = meta?.type ?? 'shell'

  // Agent tab — show sparkle instead of dot
  if (type === 'agent') {
    const isRunning = status === 'running'
    return (
      <span
        className={`shrink-0 text-violet-400 ${isRunning ? 'opacity-90' : 'opacity-50'}`}
        style={{ fontSize: 10, lineHeight: 1 }}
        aria-hidden="true"
      >
        ✦
      </span>
    )
  }

  if (status === 'running') {
    return <RunningDot />
  }

  if (status === 'done') {
    return (
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400 opacity-70" />
    )
  }

  if (status === 'error') {
    return (
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400 opacity-70" />
    )
  }

  // idle
  return (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-35" />
  )
}
