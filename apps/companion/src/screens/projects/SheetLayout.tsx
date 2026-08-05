import type { ReactNode } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'

interface SheetLayoutProps {
  visible: boolean
  title: string
  onDismiss: () => void
  onSubmit: () => void
  submitLabel: string
  isSubmitting?: boolean
  children: ReactNode
}

// Shared Modal + backdrop + rounded-top card layout for New Project /
// New Tab / Rename sheets. Extracted so bumping the sheet chrome
// (rounding, header spacing, backdrop color) is a one-file change.
export function SheetLayout({
  visible,
  title,
  onDismiss,
  onSubmit,
  submitLabel,
  isSubmitting,
  children,
}: SheetLayoutProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable className="flex-1 bg-black/40" onPress={onDismiss} />
      <View className="rounded-t-2xl bg-background p-6">
        <Text className="mb-4 font-semibold text-foreground text-lg">
          {title}
        </Text>
        {children}
        <View className="mt-6 flex-row justify-end gap-3">
          <Pressable
            onPress={onDismiss}
            className="rounded-md px-4 py-2"
            disabled={isSubmitting}
          >
            <Text className="text-muted-foreground">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={onSubmit}
            disabled={isSubmitting}
            className="rounded-md bg-primary px-4 py-2"
          >
            <Text className="font-medium text-primary-foreground">
              {submitLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}
