import { useStore } from '@nanostores/react'
import { RunningDot } from '@/components/RunningDot'
import { $tabMeta } from '@/modules/stores/$tabMeta'

type Props = {
  tabId: string
}

/**
 * Replaces the static running indicator in tab pills.
 * Reads from `$tabMeta` (driven by ProcessTrackerMod) instead of `tab.running`.
 *
 * - running → animated RunningDot
 * - idle → dim static dot
 * - done → green dot
 * - error → red dot
 */
export function TabStatusIcon({ tabId }: Props) {
  const allMeta = useStore($tabMeta)
  const status = allMeta[tabId]?.status ?? 'idle'

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
