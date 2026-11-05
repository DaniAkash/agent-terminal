import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

/**
 * Android notification channels, one per agent state.
 *
 * Separate channels rather than one because Android hands the channel's
 * controls to the user: somebody who wants to know about blocked agents
 * but not completed ones gets exactly that, without a setting in our
 * app.
 *
 * Created before the first token request. A push naming a channel the
 * device does not have is not displayed at all.
 *
 * `lockscreenVisibility: PRIVATE` is the sensitive-content rule: a
 * locked phone shows the app name, and the text appears after
 * unlocking. iOS has the same behaviour through the user's own Show
 * Previews setting, which needs nothing from us.
 */
const CHANNELS = [
  {
    id: 'agent-awaiting',
    name: 'Agent needs attention',
    importance: Notifications.AndroidImportance.HIGH,
    description: 'An agent is blocked and waiting on you.',
  },
  {
    id: 'agent-error',
    name: 'Agent errors',
    importance: Notifications.AndroidImportance.HIGH,
    description: 'An agent exited unexpectedly.',
  },
  {
    id: 'agent-completed',
    name: 'Agent finished',
    importance: Notifications.AndroidImportance.DEFAULT,
    description: 'An agent finished its turn.',
  },
] as const

export async function createChannels(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Promise.all(
    CHANNELS.map((c) =>
      Notifications.setNotificationChannelAsync(c.id, {
        name: c.name,
        description: c.description,
        importance: c.importance,
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PRIVATE,
      }),
    ),
  )
}
