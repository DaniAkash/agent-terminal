import { FlatList, Pressable, Text, View } from 'react-native'
import { SwitcherRowItem } from './SwitcherRow'
import { useSwitcherData } from './switcher.data'
import {
  type SwitcherRow,
  type SwitcherSection,
  sectionHeading,
} from './switcher.helpers'

interface SwitcherSheetProps {
  /** Composed id of the session on screen behind the sheet, if any. */
  currentKey?: string | undefined
}

/**
 * The session list, reached by swiping up from the key rows, by the more
 * key, or by tapping the session bar.
 *
 * Ordered by what deserves attention rather than by tree position, so the
 * first row is almost always the one worth opening. Rendered flat with
 * headings instead of as nested sections: the whole point is that a run
 * of sessions reads as one ordered list, not as a folder tree.
 */
export function SwitcherSheet({ currentKey }: SwitcherSheetProps) {
  const { rows, now, deviceName, open, openDesktops } = useSwitcherData()

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={rows}
        keyExtractor={keyOf}
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
              accessibilityLabel={`Connected to ${deviceName ?? 'a desktop'}. Switch desktop.`}
              className="flex-row items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 active:bg-accent-soft"
            >
              <View className="h-1.5 w-1.5 rounded-full bg-success" />
              <Text numberOfLines={1} className="text-foreground text-xs">
                {deviceName ?? 'desktop'}
              </Text>
              <Text className="text-muted-foreground text-xs">⌄</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item, index }) => (
          <>
            {headingFor(rows, index) !== null && (
              <Text className="px-3 pt-3 pb-1 font-medium text-muted-foreground text-xs uppercase">
                {sectionHeading(item.section)}
              </Text>
            )}
            <SwitcherRowItem
              row={item}
              now={now}
              isCurrent={item.key === currentKey}
              onPress={() => open(item)}
            />
          </>
        )}
        ListEmptyComponent={
          <Text className="px-3 py-6 text-center text-muted-foreground text-sm">
            No sessions on this desktop yet.
          </Text>
        }
      />
    </View>
  )
}

function keyOf(row: SwitcherRow): string {
  return row.key
}

/** A heading renders only where the section actually changes. */
function headingFor(
  rows: SwitcherRow[],
  index: number,
): SwitcherSection | null {
  const section = rows[index]?.section
  if (section === undefined) return null
  return index === 0 || rows[index - 1]?.section !== section ? section : null
}
