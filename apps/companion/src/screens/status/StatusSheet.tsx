import { useStore } from '@nanostores/react'
import { Text, View } from 'react-native'
import { $session } from '@/modules/stores/$session'
import { $tabState } from '@/modules/stores/$tabState'
import { dotClass } from '@/screens/tab/tab-status.helpers'
import { type StatusField, sessionStatus } from './status.helpers'

interface StatusSheetProps {
  projectId: string
  /** Composed wire id, which is how both the tree and tab_state key it. */
  tabId: string
}

/** Everything the desktop currently knows about one session. */
export function StatusSheet({ projectId, tabId }: StatusSheetProps) {
  const session = useStore($session)
  const states = useStore($tabState)

  const project = session.projects.find((p) => p.project_id === projectId)
  const status = sessionStatus(project, tabId, states[tabId], Date.now())

  if (!status) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-muted-foreground text-sm">
          This session is no longer on the desktop.
        </Text>
      </View>
    )
  }

  return (
    <View collapsable={false} className="flex-1 gap-4 bg-background px-4 pt-4">
      <View className="flex-row items-center gap-2">
        <View
          className={`h-2.5 w-2.5 rounded-full ${dotClass(status.visual)}`}
        />
        <Text
          numberOfLines={1}
          className="flex-1 font-semibold text-base text-foreground"
        >
          {status.label}
        </Text>
        <Text className="text-muted-foreground text-xs">{status.state}</Text>
      </View>

      <View className="gap-2.5">
        {status.fields.map((field) => (
          <FieldRow key={field.label} field={field} />
        ))}
      </View>
    </View>
  )
}

function FieldRow({ field }: { field: StatusField }) {
  return (
    <View className="flex-row items-start gap-3">
      <Text className="w-24 text-muted-foreground text-xs">{field.label}</Text>
      <Text
        className={`flex-1 text-foreground text-xs ${field.mono ? 'font-mono' : ''}`}
      >
        {field.value}
      </Text>
    </View>
  )
}
