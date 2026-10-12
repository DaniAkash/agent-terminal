import { useStore } from '@nanostores/react'
import { useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { $session } from '@/modules/stores/$session'
import { tabHref } from '@/screens/tab/tab.helpers'
import { type SwitcherRow, switcherOrder } from './switcher.helpers'

/**
 * Everything the switcher sheet needs.
 *
 * `now` is captured once per open rather than ticking: the sheet is a
 * glance, and a list whose ages shift under the finger is harder to read
 * than one that is a few seconds stale.
 */
export function useSwitcherData() {
  const session = useStore($session)
  const router = useRouter()
  const [now] = useState(() => Date.now())

  const rows = switcherOrder(session.projects, now)

  const open = useCallback(
    (row: SwitcherRow) => {
      // dismiss() first so the sheet is gone before the terminal below it
      // re-points, rather than animating out over a changing screen.
      router.dismissTo(tabHref(row.projectId, row.key))
    },
    [router],
  )

  return {
    rows,
    now,
    deviceName: session.deviceName,
    open,
    openDesktops: useCallback(() => router.replace('/desktops'), [router]),
  }
}
