import { CameraView } from 'expo-camera'
import { Pressable, Text, View } from 'react-native'
import { formatFingerprintForVisualCompare } from './pair.helpers'
import type { PairError, PairingQrPayload } from './pair.types'

/**
 * Presentational subcomponents for `PairScreen`. Extracted here so the
 * screen file stays a thin state-machine wrapper (routes stages →
 * components) and each stage is a pure View from props.
 */

export function ScanStage({
  hasPermission,
  onScan,
}: {
  hasPermission: boolean
  onScan: (r: { data: string }) => void
}) {
  return (
    <View className="flex-1">
      <View className="flex-1">
        {hasPermission ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onScan}
          />
        ) : (
          <View className="flex-1 items-center justify-center bg-black">
            <Text className="text-white">Requesting camera…</Text>
          </View>
        )}
      </View>
      <View className="bg-background gap-2 p-6">
        <Text className="text-foreground text-center text-lg font-semibold">
          Scan the QR from your desktop
        </Text>
        <Text className="text-muted-foreground text-center text-sm">
          Open Agent Terminal on your Mac, click the Companion button in the
          status bar, and point your camera at the QR.
        </Text>
      </View>
    </View>
  )
}

export function ConfirmStage({
  payload,
  onConfirm,
  onCancel,
}: {
  payload: PairingQrPayload
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <View className="flex-1 justify-center gap-6 p-6">
      <View className="gap-2">
        <Text className="text-muted-foreground text-center text-sm tracking-wide uppercase">
          Pairing with
        </Text>
        <Text className="text-foreground text-center text-2xl font-semibold">
          {payload.device_hint}
        </Text>
      </View>
      <View className="border-border bg-card gap-2 rounded-md border p-4">
        <Text className="text-muted-foreground text-xs tracking-wide uppercase">
          Fingerprint
        </Text>
        <Text className="text-foreground font-mono text-sm">
          {formatFingerprintForVisualCompare(payload.fingerprint)}
        </Text>
        <Text className="text-muted-foreground mt-1 text-xs">
          Compare this with the fingerprint shown on the desktop. Only tap
          Confirm if they match exactly.
        </Text>
      </View>
      <View className="gap-3">
        <Pressable
          onPress={onConfirm}
          className="bg-accent items-center rounded-md px-4 py-3"
        >
          <Text className="text-accent-foreground text-base font-semibold">
            Fingerprints match, confirm
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          className="border-border items-center rounded-md border px-4 py-3"
        >
          <Text className="text-foreground text-base">Scan again</Text>
        </Pressable>
      </View>
    </View>
  )
}

export function PairingStage({ hint }: { hint: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-2 p-6">
      <Text className="text-foreground text-lg">Pairing with {hint}…</Text>
      <Text className="text-muted-foreground text-sm">
        Connecting over your local Wi-Fi.
      </Text>
    </View>
  )
}

export function ErrorStage({
  error,
  onRetry,
  onOpenManualConnect,
}: {
  error: PairError
  onRetry: () => void
  /** Optional; when omitted the manual-token escape hatch is hidden.
   *  Callers gate on `__DEV__` so the button dead-code-eliminates
   *  from production bundles. */
  onOpenManualConnect?: () => void
}) {
  return (
    <View className="flex-1 justify-center gap-4 p-6">
      <Text className="text-destructive text-center text-lg font-semibold">
        Pairing failed
      </Text>
      <Text className="text-foreground text-center text-sm">
        {describeError(error)}
      </Text>
      <View className="gap-2">
        <Pressable
          onPress={onRetry}
          className="bg-accent items-center rounded-md px-4 py-3"
        >
          <Text className="text-accent-foreground text-base font-semibold">
            Scan again
          </Text>
        </Pressable>
        {onOpenManualConnect !== undefined && (
          <Pressable
            onPress={onOpenManualConnect}
            className="border-border items-center rounded-md border px-4 py-3"
          >
            <Text className="text-foreground text-base">
              Use manual token (dev only)
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

export function PermissionBlockedStage() {
  return (
    <View className="bg-background flex-1 items-center justify-center p-6">
      <Text className="text-foreground text-center text-lg">
        Camera access denied. Enable it in Settings to scan the pairing QR.
      </Text>
    </View>
  )
}

function describeError(error: PairError): string {
  switch (error.kind) {
    case 'permission-denied':
      return 'Camera permission was denied. Enable it in Settings to try again.'
    case 'bad-qr':
      return `That doesn't look like an Agent Terminal pairing QR. ${error.reason}`
    case 'connection-failed':
      return `Couldn't reach the desktop. ${error.reason}`
    case 'fingerprint-mismatch':
      return 'Fingerprint did not match. Cancel and start pairing again from the desktop dialog.'
    case 'pairing-token-expired':
      return 'The pairing window expired. Open the Companion dialog on the desktop again to get a fresh QR.'
    case 'timeout':
      return 'Pairing timed out. Check that the desktop is on the same Wi-Fi and try again.'
    case 'unknown':
      return error.reason
  }
}

interface NotifyStageProps {
  onEnable: () => void
  onSkip: () => void
}

/**
 * The consent gate for notification text leaving the local network.
 *
 * Names Expo and the platform push service rather than hiding them,
 * because that is exactly what the user is agreeing to. Skipping is
 * not a dead end: the same switch lives in notification settings.
 */
export function NotifyStage({ onEnable, onSkip }: NotifyStageProps) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <Text className="text-foreground text-center text-lg font-semibold">
        Know when an agent needs you
      </Text>
      <Text className="text-muted-foreground text-center text-sm">
        Your desktop will nudge this phone if you miss a notification at your
        Mac. Notification text is delivered through Expo and your platform's
        push service. Terminal output never leaves your network.
      </Text>
      <Pressable
        onPress={onEnable}
        accessibilityRole="button"
        className="bg-accent mt-2 w-full items-center rounded-md px-4 py-3 active:opacity-80"
      >
        <Text className="text-accent-foreground text-sm font-semibold">
          Turn on notifications
        </Text>
      </Pressable>
      <Pressable
        onPress={onSkip}
        accessibilityRole="button"
        className="border-border active:bg-accent-soft w-full items-center rounded-md border px-4 py-3"
      >
        <Text className="text-muted-foreground text-sm">Not now</Text>
      </Pressable>
    </View>
  )
}
