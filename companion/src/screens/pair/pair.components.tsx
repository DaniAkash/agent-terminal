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
      <View className="gap-2 bg-background p-6">
        <Text className="text-center font-semibold text-foreground text-lg">
          Scan the QR from your desktop
        </Text>
        <Text className="text-center text-muted-foreground text-sm">
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
        <Text className="text-center text-muted-foreground text-sm uppercase tracking-wide">
          Pairing with
        </Text>
        <Text className="text-center font-semibold text-2xl text-foreground">
          {payload.device_hint}
        </Text>
      </View>
      <View className="gap-2 rounded-md border border-border bg-card p-4">
        <Text className="text-muted-foreground text-xs uppercase tracking-wide">
          Fingerprint
        </Text>
        <Text className="font-mono text-foreground text-sm">
          {formatFingerprintForVisualCompare(payload.fingerprint)}
        </Text>
        <Text className="mt-1 text-muted-foreground text-xs">
          Compare this with the fingerprint shown on the desktop. Only tap
          Confirm if they match exactly.
        </Text>
      </View>
      <View className="gap-3">
        <Pressable
          onPress={onConfirm}
          className="items-center rounded-md bg-accent px-4 py-3"
        >
          <Text className="font-semibold text-accent-foreground text-base">
            Fingerprints match, confirm
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          className="items-center rounded-md border border-border px-4 py-3"
        >
          <Text className="text-base text-foreground">Scan again</Text>
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
      <Text className="text-center font-semibold text-destructive text-lg">
        Pairing failed
      </Text>
      <Text className="text-center text-foreground text-sm">
        {describeError(error)}
      </Text>
      <View className="gap-2">
        <Pressable
          onPress={onRetry}
          className="items-center rounded-md bg-accent px-4 py-3"
        >
          <Text className="font-semibold text-accent-foreground text-base">
            Scan again
          </Text>
        </Pressable>
        {onOpenManualConnect !== undefined && (
          <Pressable
            onPress={onOpenManualConnect}
            className="items-center rounded-md border border-border px-4 py-3"
          >
            <Text className="text-base text-foreground">
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
    <View className="flex-1 items-center justify-center bg-background p-6">
      <Text className="text-center text-foreground text-lg">
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
