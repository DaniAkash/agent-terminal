import { useStore } from '@nanostores/react'
import { shouldShowDangerBadge } from '@/components/agent.helpers'
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
   * Whether to render the 🤘 YOLO / full-permissions badge.
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
 * Composite tab indicator used by the sidebar, tab bar, and command
 * palette. Reads `$tabMeta[tabId]` and composes every per-tab badge
 * from that snapshot.
 *
 * Note: `TabStatusIcon` (rendered internally) subscribes to `$tabMeta`
 * separately. Two subscriptions per instance in total. Nanostores
 * dedupes dispatch by identity so the runtime cost is negligible; the
 * duplication stays until TabStatusIcon accepts an optional `meta`
 * prop or is inlined here.
 *
 * Future badges (GitBadge, ModelBadge, PortsBadge) plug in here as
 * additional `show*` props. Callers opt in per surface; there is no
 * config registry, just booleans that are grep-able and type-checked.
 */
export function TabChip({
  tabId,
  density = 'compact',
  showDanger = false,
  active = false,
}: Props) {
  const allMeta = useStore($tabMeta)
  const meta = allMeta[tabId]
  const size = SIZE_BY_DENSITY[density]

  const danger = shouldShowDangerBadge(meta, showDanger)

  return (
    // gap-2 matches the sidebar's original button-level spacing between
    // DangerBadge and TabStatusIcon (8px). Invisible for surfaces that
    // opt out of DangerBadge (only one child renders, gap does not apply).
    <span className="inline-flex items-center gap-2">
      {danger && <DangerBadge size={11} />}
      <TabStatusIcon tabId={tabId} active={active} size={size} />
    </span>
  )
}
