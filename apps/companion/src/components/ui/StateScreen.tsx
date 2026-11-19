import type { ReactNode } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { ACTION_BAR_SPACE, type Action, ActionBar } from './ActionBar'
import { Icon, type IconName } from './Icon'

/** The four tones of the state vocabulary, plus neutral. */
export type StateTone = 'busy' | 'ok' | 'warn' | 'bad' | 'info'

const ICON: Record<
  StateTone,
  {
    name: IconName
    tone: 'accent' | 'success' | 'warning' | 'destructive' | 'muted'
    circle: string
  }
> = {
  busy: { name: 'loader', tone: 'accent', circle: 'bg-accent-soft' },
  ok: { name: 'check', tone: 'success', circle: 'bg-success/15' },
  warn: { name: 'circle-alert', tone: 'warning', circle: 'bg-warning/15' },
  bad: { name: 'x', tone: 'destructive', circle: 'bg-destructive/15' },
  info: { name: 'circle-alert', tone: 'muted', circle: 'bg-muted' },
}

/**
 * A full screen that states one thing: an ended pairing, a desktop that
 * cannot be reached, a phone that was removed. Icon in the state's tone,
 * a title, a sentence, optional details, and the actions in the floating
 * bar at the bottom.
 */
export function StateScreen({
  tone,
  title,
  body,
  children,
  actions = [],
  header,
}: {
  tone: StateTone
  title: string
  body: string
  children?: ReactNode
  actions?: readonly Action[]
  /** Drawn above the scrolling body, e.g. a header with the status chip. */
  header?: ReactNode
}) {
  const icon = ICON[tone]
  return (
    <View className="bg-background flex-1">
      {header}
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: 24,
          paddingBottom: actions.length > 0 ? ACTION_BAR_SPACE : 24,
        }}
      >
        <View className="items-center gap-3">
          <View
            className={`h-12 w-12 items-center justify-center rounded-full ${icon.circle}`}
          >
            {tone === 'busy' ? (
              <ActivityIndicator />
            ) : (
              <Icon name={icon.name} size={22} tone={icon.tone} />
            )}
          </View>
          <Text className="text-foreground text-center text-lg font-semibold">
            {title}
          </Text>
          <Text className="text-muted-foreground text-center text-sm">
            {body}
          </Text>
          {children}
        </View>
      </ScrollView>
      <ActionBar actions={actions} />
    </View>
  )
}
