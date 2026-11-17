import { CameraView } from 'expo-camera'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type Action, ActionBar } from '@/components/ui/ActionBar'
import { DetailCard } from '@/components/ui/DetailCard'
import { Icon } from '@/components/ui/Icon'
import { StateScreen } from '@/components/ui/StateScreen'
import { routeOfHost } from '@/modules/wss/route.helpers'
import type { DeviceMeta, PairFailure, WaitingInfo } from './pair.data'
import {
  formatFingerprintForVisualCompare,
  PAIRING_CONNECT_CAP_MS,
  type PairTry,
} from './pair.helpers'
import type { PairError, PairingQrPayload } from './pair.types'

/**
 * Presentational pieces of `PairScreen`, one per pairing state of the
 * Companion State Map. Reaching, Waiting for approval and Approved are
 * sheets over the scanner; Confirming and every ended state are full
 * screens with their actions in the floating bar.
 */

/** The desktop's approval limit (`PAIRING_APPROVAL_TIMEOUT` in wss_server.rs). */
const APPROVAL_MS = 60_000

export function ScanStage({
  hasPermission,
  onScan,
  note,
  children,
}: {
  hasPermission: boolean
  /** Undefined while a sheet is up: the camera stays as a backdrop. */
  onScan?: ((r: { data: string }) => void) | undefined
  /** Replaces the instructions, e.g. after the person canceled. */
  note?: string | undefined
  /** A sheet drawn over the camera. */
  children?: React.ReactNode
}) {
  return (
    <View className="flex-1">
      <View className="flex-1">
        {hasPermission ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            {...(onScan ? { onBarcodeScanned: onScan } : {})}
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
          {note ??
            'Open Agent Terminal on the desktop, click Companion in the status bar, and point the camera at the QR.'}
        </Text>
      </View>
      {children !== undefined && (
        <View className="absolute inset-0 justify-end">
          <View className="absolute inset-0 bg-black/60" />
          {children}
        </View>
      )}
    </View>
  )
}

/** A bottom sheet over the scanner, for the states between Confirm and Paired. */
function Sheet({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{ paddingBottom: insets.bottom + 16 }}
      className="border-border bg-background items-center gap-3 rounded-t-2xl border-t px-5 pt-2"
    >
      <View className="bg-border mb-1 h-1 w-9 rounded-full" />
      {children}
    </View>
  )
}

function SheetButton({
  label,
  onPress,
  kind = 'secondary',
}: {
  label: string
  onPress: () => void
  kind?: 'primary' | 'secondary' | 'link'
}) {
  if (kind === 'link') {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
        <Text className="text-muted-foreground py-1 text-sm underline">
          {label}
        </Text>
      </Pressable>
    )
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={
        kind === 'primary'
          ? 'bg-accent w-full items-center rounded-md px-4 py-3 active:opacity-80'
          : 'border-border active:bg-accent-soft w-full items-center rounded-md border px-4 py-3'
      }
    >
      <Text
        className={
          kind === 'primary'
            ? 'text-accent-foreground text-base font-semibold'
            : 'text-foreground text-base'
        }
      >
        {label}
      </Text>
    </Pressable>
  )
}

/** Re-render every `ms` while mounted, for a countdown. */
function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now)
  // useEffect exception: a timer, an external clock.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** The model and platform line, as the desktop prompt shows it too. */
function modelLine(meta: DeviceMeta): string {
  const platform =
    meta.platform === 'android'
      ? 'Android'
      : meta.platform === 'ios'
        ? 'iOS'
        : meta.platform
  return meta.model ? `${meta.model} · ${platform}` : platform
}

/** The host the confirm screen names: the route this QR leads with. */
function leadingHost(payload: PairingQrPayload): string | undefined {
  return payload.tailscale_host ?? payload.host ?? payload.ips[0]
}

export function ConfirmStage({
  payload,
  meta,
  onConfirm,
  onCancel,
}: {
  payload: PairingQrPayload
  meta: DeviceMeta
  onConfirm: () => void
  onCancel: () => void
}) {
  const host = leadingHost(payload)
  return (
    <View className="bg-background flex-1">
      <View className="flex-1 gap-4 p-6 pb-40">
        <View className="items-center gap-1">
          <Text className="text-muted-foreground text-xs tracking-wide uppercase">
            Pairing with
          </Text>
          <Text className="text-foreground text-center text-2xl font-semibold">
            {payload.device_hint}
          </Text>
        </View>
        <DetailCard
          rows={[
            {
              label: 'Fingerprint',
              value: formatFingerprintForVisualCompare(payload.fingerprint),
              mono: true,
            },
            ...(host
              ? [
                  {
                    label: 'Route',
                    value: { route: routeOfHost(host), address: host },
                  },
                ]
              : []),
            {
              label: 'This phone will show as',
              value: meta.model
                ? `${meta.device_name} · ${meta.model}`
                : meta.device_name,
            },
          ]}
        />
        <Text className="text-muted-foreground text-sm">
          Compare this with the fingerprint shown on the desktop. Only tap
          Confirm if they match exactly.
        </Text>
      </View>
      <ActionBar
        actions={[
          { label: 'Fingerprints match, confirm', onPress: onConfirm },
          { label: 'Scan again', onPress: onCancel },
        ]}
      />
    </View>
  )
}

const TRY_STATE: Record<PairTry['state'], string> = {
  connecting: 'connecting…',
  'no-answer': 'no answer',
  connected: 'connected',
}

const TRY_TONE: Record<PairTry['state'], string> = {
  connecting: 'text-foreground',
  'no-answer': 'text-destructive',
  connected: 'text-success',
}

/** What was tried, one row per address in the QR. */
function Tries({ tries }: { tries: readonly PairTry[] }) {
  return (
    <View className="w-full gap-1">
      {tries.map((t) => (
        <View key={t.host} className="flex-row justify-between gap-2">
          <Text
            numberOfLines={1}
            className="text-muted-foreground flex-1 font-mono text-xs"
          >
            {t.route === 'wifi' ? `${t.host} (local)` : t.host}
          </Text>
          <Text className={`font-mono text-xs ${TRY_TONE[t.state]}`}>
            {TRY_STATE[t.state]}
          </Text>
        </View>
      ))}
    </View>
  )
}

export function ReachingSheet({
  desk,
  tries,
  startedAt,
  onCancel,
}: {
  desk: string
  tries: readonly PairTry[]
  startedAt: number
  onCancel: () => void
}) {
  const now = useNow(500)
  const elapsed = Math.min(
    PAIRING_CONNECT_CAP_MS / 1000,
    Math.floor((now - startedAt) / 1000),
  )
  return (
    <Sheet>
      <ActivityIndicator />
      <Text className="text-foreground text-center text-lg font-semibold">
        Reaching {desk}
      </Text>
      <Text className="text-muted-foreground text-center text-sm">
        Trying every route in the QR.
      </Text>
      <Tries tries={tries} />
      <Text className="text-muted-foreground font-mono text-xs">
        {elapsed} s of {PAIRING_CONNECT_CAP_MS / 1000} s
      </Text>
      <SheetButton label="Cancel" onPress={onCancel} />
    </Sheet>
  )
}

export function WaitingSheet({
  desk,
  info,
  onCancel,
}: {
  desk: string
  info: WaitingInfo
  onCancel: () => void
}) {
  const now = useNow(250)
  const leftMs = Math.max(0, info.startedAt + APPROVAL_MS - now)
  return (
    <Sheet>
      <View className="bg-accent-soft h-11 w-11 items-center justify-center rounded-full">
        <Icon name="hourglass" size={20} tone="accent" />
      </View>
      <Text className="text-foreground text-center text-lg font-semibold">
        Waiting for approval
      </Text>
      <Text className="text-muted-foreground text-center text-sm">
        Approve this phone on {desk}.
      </Text>
      <View className="bg-border h-1 w-full overflow-hidden rounded-full">
        <View
          className="bg-accent h-full"
          style={{ width: `${(leftMs / APPROVAL_MS) * 100}%` }}
        />
      </View>
      <Text className="text-muted-foreground font-mono text-xs">
        {Math.ceil(leftMs / 1000)} s left
      </Text>
      <DetailCard
        rows={[
          { label: 'Shown on the desktop as', value: info.meta.device_name },
          { label: 'Model', value: modelLine(info.meta) },
          { label: 'Route', value: { route: info.route, address: info.host } },
        ]}
      />
      <SheetButton label="Cancel request" onPress={onCancel} />
    </Sheet>
  )
}

/**
 * The consent gate for notification text leaving the local network,
 * asked right after pairing, when the reason is obvious.
 *
 * Names Expo and the platform push service rather than hiding them,
 * because that is exactly what the user is agreeing to. Skipping is
 * not a dead end: the same switch lives in notification settings.
 */
export function NotifySheet({
  desk,
  onEnable,
  onSkip,
}: {
  desk: string
  onEnable: () => void
  onSkip: () => void
}) {
  return (
    <Sheet>
      <View className="bg-success/15 h-11 w-11 items-center justify-center rounded-full">
        <Icon name="check" size={20} tone="success" />
      </View>
      <Text className="text-muted-foreground text-xs tracking-wide uppercase">
        Paired with {desk}
      </Text>
      <Text className="text-foreground text-center text-lg font-semibold">
        Know when an agent needs you
      </Text>
      <Text className="text-muted-foreground text-center text-sm">
        Your desktop will nudge this phone if you miss a notification.
        Notification text is delivered through Expo and your platform's push
        service. Terminal output never leaves your network.
      </Text>
      <SheetButton
        label="Turn on notifications"
        onPress={onEnable}
        kind="primary"
      />
      <SheetButton label="Not now" onPress={onSkip} kind="link" />
    </Sheet>
  )
}

/** Copy of each ended pairing state; every one ends with Scan again. */
function resultCopy(
  failure: PairFailure,
  desk: string,
): { tone: 'bad' | 'warn'; title: string; body: string } {
  if (failure.kind === 'unreachable') {
    return {
      tone: 'bad',
      title: `Can't reach ${desk}`,
      body: 'None of the routes in the QR answered. Check that Tailscale is on, or that both devices are on the same network.',
    }
  }
  if (failure.kind === 'interrupted') {
    return {
      tone: 'warn',
      title: 'The request ended',
      body: `The connection to ${desk} closed before the request was answered. Nothing was paired.`,
    }
  }
  switch (failure.refusal) {
    case 'declined':
      return {
        tone: 'bad',
        title: 'Declined on the desktop',
        body: `The request from this phone was declined on ${desk}. Nothing was paired.`,
      }
    case 'canceled':
      return {
        tone: 'warn',
        title: 'Canceled on the desktop',
        body: `The pairing dialog on ${desk} was closed before the request was answered. Open it again and scan the new QR.`,
      }
    case 'timed-out':
      return {
        tone: 'warn',
        title: 'Timed out',
        body: `Nobody approved this phone on ${desk} within 60 seconds. Nothing was paired.`,
      }
    case 'expired':
      return {
        tone: 'warn',
        title: 'This QR is no longer valid',
        body: `The pairing dialog on ${desk} was reopened, which made a new QR. Scan the QR shown there now.`,
      }
    case 'refused':
      return {
        tone: 'bad',
        title: 'Refused by the desktop',
        body: `${desk} did not accept this request: ${failure.reason}`,
      }
  }
}

/** A pairing that ended without a paired device: one screen per cause. */
export function ResultStage({
  failure,
  desk,
  onScanAgain,
  onTryAgain,
}: {
  failure: PairFailure
  desk: string
  onScanAgain: () => void
  onTryAgain: () => void
}) {
  const copy = resultCopy(failure, desk)
  const actions: Action[] =
    failure.kind === 'unreachable'
      ? [
          { label: 'Try again', onPress: onTryAgain },
          { label: 'Scan again', onPress: onScanAgain },
        ]
      : [{ label: 'Scan again', onPress: onScanAgain }]
  return (
    <StateScreen
      tone={copy.tone}
      title={copy.title}
      body={copy.body}
      actions={actions}
    >
      {failure.kind === 'unreachable' && failure.tries.length > 0 && (
        <Tries tries={failure.tries} />
      )}
    </StateScreen>
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
    <StateScreen
      tone="bad"
      title="Pairing failed"
      body={describeError(error)}
      actions={[
        { label: 'Scan again', onPress: onRetry },
        ...(onOpenManualConnect !== undefined
          ? [
              {
                label: 'Use manual token (dev only)',
                onPress: onOpenManualConnect,
              },
            ]
          : []),
      ]}
    />
  )
}

export function PermissionBlockedStage({
  onOpenManualConnect,
}: {
  onOpenManualConnect?: () => void
}) {
  return (
    <StateScreen
      tone="warn"
      title="Camera access denied"
      body="Enable it in Settings to scan the pairing QR."
      // Without this a simulator cannot pair at all, which is where
      // most development happens: there is no camera to scan with. Dev
      // builds only, like the other entry point.
      actions={
        onOpenManualConnect !== undefined
          ? [
              {
                label: 'Use manual token (dev only)',
                onPress: onOpenManualConnect,
              },
            ]
          : []
      }
    />
  )
}

function describeError(error: PairError): string {
  switch (error.kind) {
    case 'permission-denied':
      return 'Camera permission was denied. Enable it in Settings to try again.'
    case 'bad-qr':
      return `That doesn't look like an Agent Terminal pairing QR. ${error.reason}`
    case 'unknown':
      return error.reason
  }
}
