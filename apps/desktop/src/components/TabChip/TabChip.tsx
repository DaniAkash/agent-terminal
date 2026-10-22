import { deriveTabVisual } from '@agent-terminal/core-ui'
import { useStore } from '@nanostores/react'
import { tabVisualInput } from '@/components/agent.helpers'
import { DangerBadge } from '@/components/DangerBadge'
import { TabStatusIcon } from '@/components/TabStatusIcon'
import { $tabMeta } from '@/modules/stores/$tabMeta'

/**
 * Density tokens map to icon sizes. Kept named so surfaces signal intent
 * ("this is the dense sidebar variant") rather than hard-coding pixel
 * values that drift over time. All three densities are 14px today; the
 * indirection is deliberate so surface-specific bumps happen in one spot.
 */
const SIZE_BY_DENSITY = {
  compact: 14, // Sidebar list row
  medium: 14, // Tab bar pill
  comfortable: 14, // Command bar / TabSwitcher row
} as const
export type TabChipDensity = keyof typeof SIZE_BY_DENSITY

type Props = {
  tabId: string
  density?: TabChipDensity
  /**
   * Whether to render the 🤘 full-permissions badge.
   *
   * Default is false. The sidebar is the trust surface and opts in; the
   * tab bar and command palette intentionally omit the badge to reduce
   * visual noise for a signal that is already visible one glance to the
   * left. Flip on per surface if that visibility split ever changes.
   */
  showDanger?: boolean
  active?: boolean
}

/**
 * Composite tab indicator used by the sidebar, tab bar and command
 * palette.
 *
 * This is the single subscription point: it reads `$tabMeta[tabId]`,
 * derives the whole visual once through the shared package, and hands
 * the result down. Children take a decided `TabVisual` rather than an id
 * to look up, so there is one subscription per chip instead of two and
 * no way for the parts of one icon to disagree with each other.
 */
export function TabChip({
  tabId,
  density = 'compact',
  showDanger = false,
  active = false,
}: Props) {
  const allMeta = useStore($tabMeta)
  const visual = deriveTabVisual(
    tabVisualInput(allMeta[tabId], active),
    Date.now(),
  )

  return (
    // gap-2 matches the sidebar's original button-level spacing between
    // DangerBadge and TabStatusIcon (8px). Invisible for surfaces that
    // opt out of DangerBadge (only one child renders, gap does not apply).
    <span className="inline-flex items-center gap-2">
      {showDanger && visual.showDanger && <DangerBadge size={11} />}
      <TabStatusIcon visual={visual} size={SIZE_BY_DENSITY[density]} />
    </span>
  )
}
