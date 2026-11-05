import * as Notifications from 'expo-notifications'
import { $devices } from '@/modules/stores/$devices'
import { $visibleTab } from './$visibleTab'
import { shouldPresentInForeground } from './push.routing.helpers'
import { pushDataSchema } from './push.types'

/**
 * Foreground presentation.
 *
 * A banner over the very screen it is about is noise, so a push that
 * lands while the user is already looking at that tab is swallowed.
 *
 * This lives on the phone rather than as a presence frame to the
 * desktop: it needs no protocol change, no per-connection presence
 * state, and it stays correct while the socket is mid-reconnect. The
 * cost is one wasted send, which is cheap.
 *
 * The handler must answer within 3 seconds or the notification is
 * presented anyway. This does no I/O, so it is nowhere near that.
 */
export function installForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const parsed = pushDataSchema.safeParse(notification.request.content.data)
      const present = shouldPresentInForeground(
        parsed.success ? parsed.data : null,
        $devices.get().activeId,
        $visibleTab.get(),
      )
      return {
        shouldShowBanner: present,
        shouldShowList: present,
        shouldPlaySound: present,
        shouldSetBadge: false,
      }
    },
  })
}
