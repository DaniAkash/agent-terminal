import type { InterruptIntent } from '@/modules/work/$interrupt'
import type { ActiveWork } from '@/modules/work/active-work'

export interface InterruptCopy {
  title: string
  description: string
  cancel: string
  confirm: string
}

/**
 * Wording per intent, kept out of the component so it can be asserted
 * without rendering. The count goes in the title because "are you sure"
 * tells the user nothing they did not already know.
 */
export function interruptCopy(
  intent: InterruptIntent,
  work: readonly ActiveWork[],
): InterruptCopy {
  if (intent.kind === 'quit') {
    const n = work.length
    return {
      title: `Quit with ${n} ${n === 1 ? 'tab' : 'tabs'} still working?`,
      description:
        'Quitting stops these processes. Anything an agent has not written to disk is lost.',
      cancel: 'Cancel',
      confirm: 'Quit anyway',
    }
  }
  if (intent.kind === 'restart') {
    return {
      title: 'Restart to finish the update?',
      description:
        'The update runs after a restart, which stops the work below.',
      cancel: 'Not now',
      confirm: 'Restart anyway',
    }
  }
  const only = work[0]
  if (!only) {
    return {
      title: 'Close this tab?',
      description: 'Closing the tab ends its session.',
      cancel: 'Keep tab',
      confirm: 'Close tab',
    }
  }
  return {
    title: `Close ${only.tabLabel}?`,
    description:
      only.reason === 'awaiting'
        ? 'The agent is waiting on an answer. Closing the tab discards the question and ends the session.'
        : 'Closing the tab stops what is running in it.',
    cancel: 'Keep tab',
    confirm: 'Close tab',
  }
}
