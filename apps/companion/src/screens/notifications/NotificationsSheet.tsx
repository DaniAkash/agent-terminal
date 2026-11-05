import { useStore } from '@nanostores/react'
import { Linking, Pressable, Switch, Text, View } from 'react-native'
import {
  $push,
  enablePush,
  setPushPrefs,
  syncRegistration,
} from '@/modules/push'
import { $session } from '@/modules/stores/$session'
import { formatDelay, nextDelay, statusView } from './notifications.helpers'

/**
 * The only place push is configurable.
 *
 * The desktop has no notification settings screen and does not need
 * one: desktop notifications stay on, and every push preference
 * belongs to the device that actually buzzes. Preferences ride with
 * the token in RegisterPush and are stored per device, so two phones
 * paired to one Mac each get their own answer.
 */
export function NotificationsSheet() {
  const push = useStore($push)
  const session = useStore($session)

  const status = statusView({
    support: push.support,
    permission: push.permission,
    connected: session.status === 'connected',
    desktop: push.desktop,
    enabled: push.prefs.enabled,
  })

  async function toggle(next: boolean) {
    if (!next) {
      await setPushPrefs({ enabled: false })
      syncRegistration()
      return
    }
    // Turning it on is the consent to notification text leaving the
    // local network, so this is where the OS prompt belongs if it has
    // not been answered yet.
    await enablePush()
    syncRegistration()
  }

  async function update(next: Parameters<typeof setPushPrefs>[0]) {
    await setPushPrefs(next)
    // Re-registering is how a preference reaches the desktop: there is
    // no separate settings frame, the upsert carries both.
    syncRegistration()
  }

  const canConfigure = push.prefs.enabled && push.support !== 'unsupported'

  return (
    <View collapsable={false} className="bg-background flex-1">
      <View className="px-4 pt-3 pb-1">
        <Text className="text-foreground text-base font-semibold">
          Notifications
        </Text>
        <Text className="text-muted-foreground text-xs">
          Your desktop nudges this phone only when you miss a notification at
          your Mac.
        </Text>
      </View>

      <View className="gap-1 p-2">
        <StatusRow status={status} />

        <Row
          title="Notify me when an agent needs attention"
          subtitle="Notification text is delivered through Expo and your platform's push service. Terminal output never leaves your network."
          disabled={push.support === 'unsupported'}
        >
          <Switch
            value={push.prefs.enabled}
            disabled={push.support === 'unsupported'}
            onValueChange={(v) => void toggle(v)}
            accessibilityLabel="Notify me when an agent needs attention"
          />
        </Row>

        {canConfigure ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Wait before notifying: ${formatDelay(push.prefs.delaySeconds)}`}
              onPress={() =>
                void update({
                  delaySeconds: nextDelay(push.prefs.delaySeconds),
                })
              }
              className="active:bg-accent-soft flex-row items-center gap-3 rounded-lg px-3 py-3"
            >
              <View className="flex-1">
                <Text className="text-foreground text-sm">
                  Wait before notifying
                </Text>
                <Text className="text-muted-foreground text-xs">
                  Long enough that noticing it yourself wins the race.
                </Text>
              </View>
              <Text className="text-accent text-sm">
                {formatDelay(push.prefs.delaySeconds)}
              </Text>
            </Pressable>

            <Row
              title="Hide project and tab names"
              subtitle="The nudge without the nouns."
            >
              <Switch
                value={push.prefs.redactNames}
                onValueChange={(v) => void update({ redactNames: v })}
                accessibilityLabel="Hide project and tab names"
              />
            </Row>
          </>
        ) : null}
      </View>

      <Text className="text-muted-foreground px-4 pt-1 text-xs">
        Tapping a notification opens the terminal that raised it.
      </Text>
    </View>
  )
}

function StatusRow({ status }: { status: ReturnType<typeof statusView> }) {
  const tone =
    status.tone === 'ok'
      ? 'text-success'
      : status.tone === 'bad'
        ? 'text-destructive'
        : status.tone === 'warn'
          ? 'text-warning'
          : 'text-muted-foreground'

  const body = (
    <View className="flex-row items-center gap-3 rounded-lg px-3 py-3">
      <View className="flex-1">
        <Text className="text-foreground text-sm">Status</Text>
        <Text className="text-muted-foreground text-xs">{status.detail}</Text>
      </View>
      <Text className={`text-xs ${tone}`}>{status.label}</Text>
    </View>
  )

  if (status.action !== 'open-system-settings') return body
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open system notification settings"
      onPress={() => void Linking.openSettings()}
      className="active:bg-accent-soft rounded-lg"
    >
      {body}
    </Pressable>
  )
}

interface RowProps {
  title: string
  subtitle: string
  disabled?: boolean
  children: React.ReactNode
}

function Row({ title, subtitle, disabled, children }: RowProps) {
  return (
    <View
      className={`flex-row items-center gap-3 rounded-lg px-3 py-3 ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <View className="flex-1">
        <Text className="text-foreground text-sm">{title}</Text>
        <Text className="text-muted-foreground text-xs">{subtitle}</Text>
      </View>
      {children}
    </View>
  )
}
