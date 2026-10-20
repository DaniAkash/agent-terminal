import { useStore } from '@nanostores/react'
import { type Href, useNavigation, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { $activeDevice } from '@/modules/stores/$devices'
import { $session } from '@/modules/stores/$session'
import { tabHref } from '@/screens/tab/tab.helpers'
import { type SwitcherRow, switcherOrder } from './switcher.helpers'

/**
 * Close this sheet, then present another one in its place.
 *
 * The present waits for the dismissal to actually finish rather than for
 * the next JS turn. A form sheet animates out over a few hundred
 * milliseconds, and a push issued into that window is dropped: the new
 * sheet never appears, which is the exact race this helper exists to avoid.
 * `setTimeout(0)` only looked sufficient because a warm simulator forgives
 * it.
 *
 * The navigator's own transition event is the signal, so nothing here
 * guesses at an animation duration. The timer is a backstop, not the
 * mechanism: if the event never arrives the sheet still opens rather than
 * leaving the user on a screen their tap appeared to do nothing to.
 */
const SWAP_FALLBACK_MS = 600

/** Only the part of the navigation object this helper depends on. */
interface TransitionAware {
  addListener: (event: 'transitionEnd', handler: () => void) => () => void
}

function swapSheet(
  navigation: TransitionAware,
  router: ReturnType<typeof useRouter>,
  href: string,
): void {
  let opened = false
  const open = () => {
    if (opened) return
    opened = true
    router.push(href as Href)
  }
  const stop = navigation.addListener('transitionEnd', () => {
    stop()
    open()
  })
  setTimeout(open, SWAP_FALLBACK_MS)
  router.back()
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
  const device = useStore($activeDevice)
  const router = useRouter()
  const navigation = useNavigation<TransitionAware>()
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
    // The paired desktop's name. `session.deviceName` is this phone's own
    // name echoed back from pairing, which is not what "connected to"
    // means on a control that switches between desktops.
    deviceName: device.record?.deviceHint ?? null,
    open,
    // Sibling sheets, not pushes: Android does not allow a nested stack
    // navigator inside a form sheet. Dismissed first rather than replaced,
    // because replacing one sheet with another leaves the stack holding a
    // route that has already animated away, and the next present is a
    // no-op against it.
    openDesktops: useCallback(
      () => swapSheet(navigation, router, '/desktops'),
      [navigation, router],
    ),
    openDetails: useCallback(
      (row: SwitcherRow) =>
        swapSheet(navigation, router, `/status/${row.projectId}/${row.tabId}`),
      [navigation, router],
    ),
    openWorkspace: useCallback(
      (row: SwitcherRow) =>
        swapSheet(navigation, router, `/project/${row.projectId}/edit`),
      [navigation, router],
    ),
  }
}
