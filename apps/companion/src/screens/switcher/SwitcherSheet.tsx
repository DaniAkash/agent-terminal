import type { SessionNode } from '@agent-terminal/core-ui'
import { useActionSheet } from '@expo/react-native-action-sheet'
import { useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { Icon } from '@/components/ui/Icon'
import { NewProjectSheet } from '@/screens/projects/NewProjectSheet'
import { SwitcherRowItem } from './SwitcherRow'
import { SwitcherViewToggle } from './SwitcherViewToggle'
import { useSwitcherData } from './switcher.data'
import { type SwitcherItem, switcherItemKey } from './switcher.list'
import { WorkspaceHeader } from './WorkspaceHeader'

interface SwitcherSheetProps {
  /** Composed id of the session on screen behind the sheet, if any. */
  currentKey?: string | undefined
}

/**
 * The session list, reached by swiping up from the key rows, by the more
 * key, or by tapping the session bar.
 *
 * Two views, the same two the desktop sidebar has, built from the same
 * ordering: the workspace tree, or the flat recency list. A turn waiting
 * on an answer is marked by its glyph rather than by a section of its
 * own, which means it stays visible in both views instead of only in the
 * one that sorted it to the top.
 */
export function SwitcherSheet({ currentKey }: SwitcherSheetProps) {
  const {
    items,
    view,
    now,
    setView,
    toggle,
    isCollapsed,
    deviceName,
    open,
    openDesktops,
    openDetails,
    openWorkspace,
  } = useSwitcherData(currentKey)
  const { showActionSheetWithOptions } = useActionSheet()
  const [showNewProject, setShowNewProject] = useState(false)

  function openRowMenu(node: SessionNode) {
    showActionSheetWithOptions(
      {
        options: ['Session details', `Edit ${node.projectName}`, 'Cancel'],
        cancelButtonIndex: 2,
        title: node.label,
      },
      (index?: number) => {
        if (index === 0) openDetails(node)
        else if (index === 1) openWorkspace(node.projectId)
      },
    )
  }

  // collapsable={false} is load-bearing. React Native flattens a view that
  // only groups children, which hoists them into the screen wrapper and
  // loses this flex container: inside a detent-sized sheet the content then
  // lays out below the visible area at zero height, so every row mounts and
  // nothing paints.
  return (
    <View collapsable={false} className="flex-1 bg-background">
      <FlatList
        data={items}
        keyExtractor={switcherItemKey}
        // flex is load-bearing, not cosmetic. Without it the list has no
        // definite height inside the sheet's detent-sized container: it
        // lays out at zero height below the visible area, so every row
        // mounts and nothing paints.
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 32 }}
        // The title row rides inside the list rather than beside it. As a
        // sibling it ended up overlapping the first heading: the sheet
        // sizes itself to its detent, and the list did not lay out below
        // the header inside that.
        ListHeaderComponent={
          <View className="gap-2 px-2 pt-3 pb-1">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-base text-foreground">
                Sessions
              </Text>
              <Pressable
                onPress={openDesktops}
                accessibilityRole="button"
                accessibilityLabel={`Connected to ${deviceName ?? 'a desktop'}. Switch desktop.`}
                className="flex-row items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 active:bg-accent-soft"
              >
                <View className="h-1.5 w-1.5 rounded-full bg-success" />
                <Text numberOfLines={1} className="text-foreground text-xs">
                  {deviceName ?? 'desktop'}
                </Text>
                <Icon name="chevron-down" size={13} />
              </Pressable>
            </View>
            <SwitcherViewToggle view={view} onChange={setView} />
          </View>
        }
        renderItem={({ item }) => (
          <SwitcherItemRow
            item={item}
            now={now}
            onOpen={open}
            onMenu={openRowMenu}
            onToggle={toggle}
            isCollapsed={isCollapsed}
            onNewSession={openWorkspace}
          />
        )}
        ListFooterComponent={
          <Pressable
            onPress={() => setShowNewProject(true)}
            accessibilityRole="button"
            className="mx-1 mt-3 items-center rounded-lg border border-border px-3 py-2.5 active:bg-accent-soft"
          >
            <Text className="text-foreground text-sm">New workspace</Text>
          </Pressable>
        }
      />
      <NewProjectSheet
        visible={showNewProject}
        onDismiss={() => setShowNewProject(false)}
      />
    </View>
  )
}

/** One row, dispatched on which kind of item the flattened list holds. */
function SwitcherItemRow({
  item,
  now,
  onOpen,
  onMenu,
  onToggle,
  isCollapsed,
  onNewSession,
}: {
  item: SwitcherItem
  now: number
  onOpen: (node: SessionNode) => void
  onMenu: (node: SessionNode) => void
  onToggle: (
    group: Extract<SwitcherItem, { type: 'workspace' }>['group'],
  ) => void
  isCollapsed: (
    group: Extract<SwitcherItem, { type: 'workspace' }>['group'],
  ) => boolean
  onNewSession: (projectId: string) => void
}) {
  if (item.type === 'empty') {
    return (
      <Text className="px-3 py-6 text-center text-muted-foreground text-sm">
        No sessions on this desktop yet.
      </Text>
    )
  }

  if (item.type === 'workspace') {
    return (
      <WorkspaceHeader
        group={item.group}
        collapsed={isCollapsed(item.group)}
        onToggle={() => onToggle(item.group)}
        onNewSession={() => onNewSession(item.group.projectId)}
      />
    )
  }

  return (
    <SwitcherRowItem
      node={item.node}
      now={now}
      variant={item.variant}
      onPress={() => onOpen(item.node)}
      onLongPress={() => onMenu(item.node)}
      onMenu={() => onMenu(item.node)}
    />
  )
}
