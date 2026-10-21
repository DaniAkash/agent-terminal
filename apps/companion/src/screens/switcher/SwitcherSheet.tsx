import { useActionSheet } from '@expo/react-native-action-sheet'
import { useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { NewProjectSheet } from '@/screens/projects/NewProjectSheet'
import { DeviceGroupHeader } from './DeviceGroupHeader'
import { SwitcherRowItem } from './SwitcherRow'
import { useSwitcherData } from './switcher.data'
import {
  type SwitcherListItem,
  type SwitcherRow,
  sectionHeading,
  switcherListItemKey,
} from './switcher.helpers'

interface SwitcherSheetProps {
  /** Composed id of the session on screen behind the sheet, if any. */
  currentKey?: string | undefined
}

/**
 * The session list, reached by swiping up from the key rows, by the more
 * key, or by tapping the session bar.
 *
 * One section per paired desktop rather than one flat list for whichever
 * desktop happens to be driving the socket: switching desktops used to
 * replace the whole list, which is what made a second paired desktop's
 * sessions look like they had vanished. Each device's own rows are still
 * ordered by what deserves attention rather than tree position.
 */
export function SwitcherSheet({ currentKey }: SwitcherSheetProps) {
  const {
    items,
    now,
    toggleCollapsed,
    open,
    openDevice,
    openDesktops,
    openDetails,
    openWorkspace,
  } = useSwitcherData()
  const { showActionSheetWithOptions } = useActionSheet()
  const [showNewProject, setShowNewProject] = useState(false)

  function openRowMenu(row: SwitcherRow) {
    showActionSheetWithOptions(
      {
        options: ['Session details', `Edit ${row.projectName}`, 'Cancel'],
        cancelButtonIndex: 2,
        title: row.label,
      },
      (index?: number) => {
        if (index === 0) openDetails(row)
        else if (index === 1) openWorkspace(row)
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
        keyExtractor={switcherListItemKey}
        // flex is load-bearing, not cosmetic. Without it the list has no
        // definite height inside the sheet's detent-sized container: it
        // lays out at zero height below the visible area, so every row
        // mounts and nothing paints.
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 32 }}
        // The title row rides inside the list rather than beside it. As a
        // sibling it ended up overlapping the first section heading: the
        // sheet sizes itself to its detent, and the list did not lay out
        // below the header inside that.
        ListHeaderComponent={
          <View className="flex-row items-center justify-between px-2 pt-3 pb-1">
            <Text className="font-semibold text-base text-foreground">
              Sessions
            </Text>
            <Pressable
              onPress={openDesktops}
              accessibilityRole="button"
              accessibilityLabel="Pair another desktop"
              className="rounded-full bg-muted px-3 py-1.5 active:bg-accent-soft"
            >
              <Text className="text-foreground text-xs">+ Desktop</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => renderSwitcherItem(item)}
        ListEmptyComponent={
          <Text className="px-3 py-6 text-center text-muted-foreground text-sm">
            No paired desktops yet.
          </Text>
        }
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

  function renderSwitcherItem(item: SwitcherListItem) {
    if (item.type === 'device') {
      return (
        <DeviceGroupHeader
          group={item.group}
          now={now}
          onPress={() => openDevice(item.group.deviceId)}
          onToggleCollapsed={() => toggleCollapsed(item.group.deviceId)}
        />
      )
    }
    if (item.type === 'heading') {
      return (
        <Text className="px-3 pt-3 pb-1 font-medium text-muted-foreground text-xs uppercase">
          {sectionHeading(item.section)}
        </Text>
      )
    }
    if (item.type === 'empty') {
      return (
        <Text className="px-3 py-3 text-muted-foreground text-sm">
          No sessions on this desktop yet.
        </Text>
      )
    }
    return (
      <SwitcherRowItem
        row={item.row}
        now={now}
        isCurrent={item.row.key === currentKey}
        onPress={() => open(item.row)}
        onLongPress={() => openRowMenu(item.row)}
        onMenu={() => openRowMenu(item.row)}
      />
    )
  }
}
