import { useStore } from '@nanostores/react'
import { type Href, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { $session } from '@/modules/stores/$session'
import { tabHref } from '@/screens/tab/tab.helpers'
import { type SwitcherRow, switcherOrder } from './switcher.helpers'

/**
 * Close this sheet, then present another one in its place. The dismiss has
 * to settle before the next present, or the new sheet races the outgoing
 * animation and never appears.
 */
function swapSheet(router: ReturnType<typeof useRouter>, href: string): void {
  router.back()
  setTimeout(() => router.push(href as Href), 0)
}

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
    // Sibling sheets, not pushes: Android does not allow a nested stack
    // navigator inside a form sheet. Dismissed first rather than replaced,
    // because replacing one sheet with another leaves the stack holding a
    // route that has already animated away, and the next present is a
    // no-op against it.
    openDesktops: useCallback(() => swapSheet(router, '/desktops'), [router]),
    openDetails: useCallback(
      (row: SwitcherRow) =>
        swapSheet(router, `/status/${row.projectId}/${row.tabId}`),
      [router],
    ),
    openWorkspace: useCallback(
      (row: SwitcherRow) => swapSheet(router, `/project/${row.projectId}/edit`),
      [router],
    ),
  }
}
