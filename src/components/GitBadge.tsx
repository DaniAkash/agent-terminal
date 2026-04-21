import { useStore } from '@nanostores/react'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { MONO_FONT } from '@/screens/workspace/workspace.helpers'

type Props = {
  tabId: string
}

/**
 * Shows git branch info for the active tab.
 * Driven by GitMonitorMod — renders only when git context is available.
 *
 * Format: `<branch>[*][+N][-N]`
 *  - `*`  → working tree is dirty
 *  - `+N` → N commits ahead of upstream
 *  - `-N` → N commits behind upstream
 */
export function GitBadge({ tabId }: Props) {
  const allMeta = useStore($tabMeta)
  const git = allMeta[tabId]?.git

  if (!git?.branch) return null

  const ahead = git.aheadBy > 0 ? `+${git.aheadBy}` : ''
  const behind = git.behindBy > 0 ? `-${git.behindBy}` : ''
  const dirty = git.isDirty ? '*' : ''

  const label = `${git.branch}${dirty}${ahead}${behind}`

  return (
    <span
      className="pointer-events-none text-tab-fg opacity-50"
      style={{ fontFamily: MONO_FONT, fontSize: 10.5 }}
    >
      {label}
    </span>
  )
}
