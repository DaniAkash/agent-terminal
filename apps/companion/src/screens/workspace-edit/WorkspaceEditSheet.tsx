import { useActionSheet } from '@expo/react-native-action-sheet'
import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'
import DraggableFlatList, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Icon } from '@/components/ui/Icon'
import { $session } from '@/modules/stores/$session'
import {
  sendRemoveProject,
  sendRemoveTab,
  sendReorderTabs,
  sendSetProjectPinned,
  sendSetTabPinned,
} from '@/modules/wss/client'
import type { TabSummary } from '@/modules/wss/protocol.gen'
import { NewTabSheet } from '@/screens/projects/NewTabSheet'
import { RenameSheet, type RenameTarget } from '@/screens/projects/RenameSheet'
import { sessionLabel } from '@/screens/tab/tab-label.helpers'
import { reorderMove } from './workspace-edit.helpers'

/**
 * Reorder, pin, rename and delete the sessions in one workspace.
 *
 * Everything here writes through the desktop rather than optimistically:
 * the resulting Projects frame is what redraws the list, so the phone can
 * never show an order the desktop does not have.
 */
// Complexity here is branch-per-prop JSX, not logic: the derivation it
// renders lives in tested pure helpers alongside. CRAP is high because
// this repo has no component-test harness, not because the function is
// hard to follow. Follow-up: a render-level test setup would retire this.
// fallow-ignore-next-line complexity
export function WorkspaceEditSheet({ projectId }: { projectId: string }) {
  const session = useStore($session)
  const { showActionSheetWithOptions } = useActionSheet()
  const [showNewTab, setShowNewTab] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)

  const project = session.projects.find((p) => p.project_id === projectId)

  if (!project) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-muted-foreground text-sm">
          This workspace is no longer on the desktop.
        </Text>
      </View>
    )
  }

  function openTabMenu(tab: TabSummary) {
    showActionSheetWithOptions(
      {
        options: [tab.pinned ? 'Unpin' : 'Pin', 'Rename', 'Delete', 'Cancel'],
        destructiveButtonIndex: 2,
        cancelButtonIndex: 3,
        title: sessionLabel(tab),
      },
      (idx) => {
        if (idx === 0) {
          sendSetTabPinned({
            project_id: projectId,
            tab_id: tab.tab_id,
            pinned: !tab.pinned,
          }).catch((err) => Alert.alert('Pin failed', String(err)))
        } else if (idx === 1) {
          setRenameTarget({
            kind: 'tab',
            projectId,
            tabId: tab.tab_id,
            currentLabel: tab.label,
          })
        } else if (idx === 2) {
          Alert.alert('Delete session?', sessionLabel(tab), [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                sendRemoveTab({
                  project_id: projectId,
                  tab_id: tab.tab_id,
                }).catch((err) => Alert.alert('Delete failed', String(err)))
              },
            },
          ])
        }
      },
    )
  }

  function openWorkspaceMenu() {
    if (!project) return
    showActionSheetWithOptions(
      {
        options: ['Rename', 'Delete workspace', 'Cancel'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
        title: project.name,
      },
      (index?: number) => {
        if (index === 0) {
          setRenameTarget({
            kind: 'project',
            projectId,
            currentName: project.name,
          })
        } else if (index === 1) {
          Alert.alert(
            'Delete workspace?',
            `${project.name} and all its sessions will be removed.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  sendRemoveProject({ project_id: projectId }).catch((err) =>
                    Alert.alert('Delete failed', String(err)),
                  )
                },
              },
            ],
          )
        }
      },
    )
  }

  function handleDragEnd(after: TabSummary[]) {
    const move = reorderMove(project?.tabs ?? [], after)
    if (!move) return
    sendReorderTabs({ project_id: projectId, ...move }).catch((err) =>
      Alert.alert('Reorder failed', String(err)),
    )
  }

  const pinned = project.pinned === true

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="flex-row items-center gap-2 px-4 pt-3 pb-2">
        <View className="flex-1">
          <Text
            numberOfLines={1}
            className="font-semibold text-base text-foreground"
          >
            {project.name}
          </Text>
          {project.path && (
            <Text numberOfLines={1} className="text-muted-foreground text-xs">
              {project.path}
            </Text>
          )}
        </View>
        <Pressable
          onPress={() =>
            sendSetProjectPinned({
              project_id: projectId,
              pinned: !pinned,
            }).catch((err) => Alert.alert('Pin failed', String(err)))
          }
          accessibilityRole="button"
          accessibilityLabel={pinned ? 'Unpin workspace' : 'Pin workspace'}
          className="rounded-md border border-border px-2 py-1 active:bg-accent-soft"
        >
          <Icon name={pinned ? 'pin-off' : 'pin'} size={13} tone="foreground" />
        </Pressable>
        <Pressable
          onPress={() => setShowNewTab(true)}
          accessibilityRole="button"
          className="rounded-md border border-border px-2 py-1 active:bg-accent-soft"
        >
          <View className="flex-row items-center gap-1">
            <Icon name="plus" size={12} tone="foreground" />
            <Text className="text-foreground text-xs">Session</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={openWorkspaceMenu}
          accessibilityRole="button"
          accessibilityLabel="Workspace options"
          className="rounded-md border border-border px-2 py-1 active:bg-accent-soft"
        >
          <Icon name="ellipsis-vertical" size={14} tone="foreground" />
        </Pressable>
      </View>

      <Text className="px-4 pb-2 text-muted-foreground text-xs">
        Drag the handle to reorder. Long press a session for more.
      </Text>

      <DraggableFlatList
        data={project.tabs}
        keyExtractor={(tab) => tab.tab_id}
        onDragEnd={({ data }) => handleDragEnd(data)}
        activationDistance={5}
        containerStyle={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        renderItem={(params) => (
          <EditableTabRow {...params} onMore={() => openTabMenu(params.item)} />
        )}
      />

      <NewTabSheet
        projectId={showNewTab ? projectId : null}
        onDismiss={() => setShowNewTab(false)}
      />
      <RenameSheet
        target={renameTarget}
        onDismiss={() => setRenameTarget(null)}
      />
    </GestureHandlerRootView>
  )
}

interface EditableTabRowProps extends RenderItemParams<TabSummary> {
  onMore: () => void
}

// fallow-ignore-next-line complexity
function EditableTabRow({ item, drag, isActive, onMore }: EditableTabRowProps) {
  const sleeping = !item.is_spawned
  // The handle drags and the row opens the menu. Driving both from one long
  // press meant every reorder also popped a dialog over the list you were
  // trying to rearrange, and it left the handle as decoration.
  return (
    <View
      className={`mb-1 flex-row items-center rounded-md border border-border bg-card ${sleeping ? 'opacity-60' : ''} ${isActive ? 'opacity-80' : ''}`}
    >
      <Pressable
        onLongPress={drag}
        delayLongPress={160}
        disabled={isActive}
        accessibilityRole="button"
        accessibilityLabel={`Reorder ${sessionLabel(item)}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
        className="px-3 py-3"
      >
        <Text className="text-muted-foreground text-xs">⠿</Text>
      </Pressable>
      <Pressable
        onLongPress={onMore}
        delayLongPress={350}
        disabled={isActive}
        accessibilityRole="button"
        accessibilityLabel={`${sessionLabel(item)}${item.pinned ? ', pinned' : ''}${sleeping ? ', sleeping' : ''}. Long press for options.`}
        className="flex-1 flex-row items-center gap-2 py-3 pr-3"
      >
        <Text
          numberOfLines={1}
          className="flex-1 font-mono text-foreground text-sm"
        >
          {sessionLabel(item)}
        </Text>
        {item.pinned && <Icon name="pin" size={11} tone="foreground" />}
        {sleeping && (
          <Text className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
            sleeping
          </Text>
        )}
      </Pressable>
    </View>
  )
}
