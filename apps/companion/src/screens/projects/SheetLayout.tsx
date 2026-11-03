import type { ReactNode } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native'

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
      {/* The card has to ride above the keyboard. Every sheet here opens
          straight into a text field, and without this the submit and cancel
          buttons sit underneath it: the form could be filled in but never
          sent, which is the whole of "create a workspace" from the phone. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 justify-end"
      >
        <Pressable className="flex-1 bg-black/40" onPress={onDismiss} />
        <View className="bg-background rounded-t-2xl p-6">
          <Text className="text-foreground mb-4 text-lg font-semibold">
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
              className="bg-primary rounded-md px-4 py-2"
            >
              <Text className="text-primary-foreground font-medium">
                {submitLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
