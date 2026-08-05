import { useActionSheet } from '@expo/react-native-action-sheet'
import { Link } from 'expo-router'
import { useState } from 'react'
import { Alert, FlatList, Pressable, Text, View } from 'react-native'
import DraggableFlatList, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import {
  sendRemoveProject,
  sendRemoveTab,
  sendReorderTabs,
} from '@/modules/wss/client'
import type { ProjectSummary, TabSummary } from '@/modules/wss/protocol.gen'
import { NewProjectSheet } from './NewProjectSheet'
import { NewTabSheet } from './NewTabSheet'
import { useProjectsData } from './projects.data'
import { RenameSheet, type RenameTarget } from './RenameSheet'

// fallow-ignore-next-line complexity
export function ProjectsScreen() {
  const { projects } = useProjectsData()
  const { showActionSheetWithOptions } = useActionSheet()
  const [showNewProject, setShowNewProject] = useState(false)
  const [newTabProjectId, setNewTabProjectId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)

  function openProjectMenu(project: ProjectSummary) {
    showActionSheetWithOptions(
      {
        options: ['Rename', 'Delete', 'Cancel'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
        title: project.name,
      },
      (idx) => {
        if (idx === 0) {
          setRenameTarget({
            kind: 'project',
            projectId: project.project_id,
            currentName: project.name,
          })
        } else if (idx === 1) {
          Alert.alert(
            'Delete project?',
            `${project.name} and all its tabs will be removed.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  sendRemoveProject({ project_id: project.project_id }).catch(
                    (err) => Alert.alert('Delete failed', String(err)),
                  )
                },
              },
            ],
          )
        }
      },
    )
  }

  function openTabMenu(project: ProjectSummary, tab: TabSummary) {
    showActionSheetWithOptions(
      {
        options: ['Rename', 'Delete', 'Cancel'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
        title: tab.label,
      },
      (idx) => {
        if (idx === 0) {
          setRenameTarget({
            kind: 'tab',
            projectId: project.project_id,
            tabId: tab.tab_id,
            currentLabel: tab.label,
          })
        } else if (idx === 1) {
          Alert.alert('Delete tab?', tab.label, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                sendRemoveTab({
                  project_id: project.project_id,
                  tab_id: tab.tab_id,
                }).catch((err) => Alert.alert('Delete failed', String(err)))
              },
            },
          ])
        }
      },
    )
  }

  // GestureHandlerRootView wraps THIS screen (not the whole app)
  // per the Expo tutorial. Placing it here means the gesture-handler
  // native module isn't touched until the projects route mounts,
  // avoiding an import-time crash in the root layout.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="flex-row items-center justify-between border-border border-b bg-background px-4 py-3">
        <Text className="font-semibold text-foreground text-lg">Projects</Text>
        <Pressable
          onPress={() => setShowNewProject(true)}
          className="rounded-md bg-primary px-3 py-1.5"
        >
          <Text className="font-medium text-primary-foreground text-sm">
            + New Project
          </Text>
        </Pressable>
      </View>
      {projects.length === 0 ? (
        <View className="flex-1 items-center justify-center bg-background p-6">
          <Text className="text-muted-foreground text-sm">
            No projects yet. Tap "+ New Project" to add one.
          </Text>
        </View>
      ) : (
        <FlatList
          className="flex-1 bg-background"
          data={projects}
          keyExtractor={(p) => p.project_id}
          renderItem={({ item }) => (
            <ProjectRow
              project={item}
              onProjectLongPress={() => openProjectMenu(item)}
              onTabLongPress={(tab) => openTabMenu(item, tab)}
              onAddTab={() => setNewTabProjectId(item.project_id)}
            />
          )}
          contentContainerClassName="gap-6 p-4"
        />
      )}
      <NewProjectSheet
        visible={showNewProject}
        onDismiss={() => setShowNewProject(false)}
      />
      <NewTabSheet
        projectId={newTabProjectId}
        onDismiss={() => setNewTabProjectId(null)}
      />
      <RenameSheet
        target={renameTarget}
        onDismiss={() => setRenameTarget(null)}
      />
    </GestureHandlerRootView>
  )
}

interface ProjectRowProps {
  project: ProjectSummary
  onProjectLongPress: () => void
  onTabLongPress: (tab: TabSummary) => void
  onAddTab: () => void
}

function ProjectRow({
  project,
  onProjectLongPress,
  onTabLongPress,
  onAddTab,
}: ProjectRowProps) {
  // fallow-ignore-next-line complexity
  function handleDragEnd(data: TabSummary[]) {
    // DraggableFlatList gives us the new order after the drop. Compute
    // the delta as the first mismatched index; that's the (oldIdx,
    // newIdx) pair for a single move. Matches $projects.reorderTabs's
    // signature 1:1 so the mobile-ops listener maps trivially.
    for (let newIdx = 0; newIdx < data.length; newIdx += 1) {
      const moved = data[newIdx]
      if (!moved) continue
      const oldIdx = project.tabs.findIndex((t) => t.tab_id === moved.tab_id)
      // findIndex returns -1 if the moved tab_id isn't in our current
      // snapshot (stale render vs. a projects push that removed it).
      // Sending -1 would fail Rust's u32 decode and drop the socket;
      // bail out of the whole reorder since the drag is against stale
      // state anyway.
      if (oldIdx < 0) return
      if (oldIdx !== newIdx) {
        sendReorderTabs({
          project_id: project.project_id,
          old_index: oldIdx,
          new_index: newIdx,
        }).catch((err) => Alert.alert('Reorder failed', String(err)))
        return
      }
    }
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Pressable
          onLongPress={onProjectLongPress}
          delayLongPress={350}
          className="flex-1"
        >
          <Text className="font-semibold text-foreground text-lg">
            {project.name}
          </Text>
          {project.path && (
            <Text className="text-muted-foreground text-xs">
              {project.path}
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={onAddTab}
          className="rounded-md border border-border px-2 py-1"
        >
          <Text className="text-foreground text-xs">+ Tab</Text>
        </Pressable>
      </View>
      <DraggableFlatList
        data={project.tabs}
        keyExtractor={(tab) => tab.tab_id}
        onDragEnd={({ data }) => handleDragEnd(data)}
        activationDistance={5}
        renderItem={(params) => (
          <TabRow {...params} onLongPress={() => onTabLongPress(params.item)} />
        )}
      />
    </View>
  )
}

interface TabRowProps extends RenderItemParams<TabSummary> {
  onLongPress: () => void
}

// fallow-ignore-next-line complexity
function TabRow({ item, drag, isActive, onLongPress }: TabRowProps) {
  const sleeping = !item.is_spawned
  const displayCwd = item.last_cwd ?? item.cwd
  return (
    <Link href={`/tab/${item.tab_id}`} asChild>
      <Pressable
        onLongPress={() => {
          drag()
          onLongPress()
        }}
        delayLongPress={350}
        disabled={isActive}
        className={`mb-1 rounded-md border border-border bg-card p-3 ${sleeping ? 'opacity-60' : ''} ${isActive ? 'opacity-80' : ''}`}
      >
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 font-mono text-foreground text-sm">
            {item.label}
          </Text>
          {sleeping && (
            <Text className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
              sleeping
            </Text>
          )}
        </View>
        {displayCwd && (
          <Text className="text-muted-foreground text-xs">{displayCwd}</Text>
        )}
      </Pressable>
    </Link>
  )
}
