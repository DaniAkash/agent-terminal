import { computed } from 'nanostores'
import { $activeTabKey } from '@/modules/stores/$activeTerminal'
import { $tabMeta } from '@/modules/stores/$tabMeta'

/** Follow live agent detection and navigation, including returning to a shell. */
export const $activeUsageProviderId = computed(
  [$activeTabKey, $tabMeta],
  (key, metadata) => {
    const tab = key ? metadata[key] : undefined
    return tab?.type === 'agent' ? (tab.agentId ?? null) : null
  },
)
