import { useCameraPermissions } from 'expo-camera'
import { Redirect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { $push, enablePush } from '@/modules/push'
import {
  ConfirmStage,
  ErrorStage,
  NotifyStage,
  PairingStage,
  PermissionBlockedStage,
  ScanStage,
} from './pair.components'
import { completePairing } from './pair.data'
import { parsePairingQr, shouldOfferPush } from './pair.helpers'
import type { PairError, PairingQrPayload } from './pair.types'

type PairStage =
  | { kind: 'scanning' }
  | { kind: 'confirm'; payload: PairingQrPayload }
  | { kind: 'pairing'; payload: PairingQrPayload }
  /** Offer push, now that the user has a desktop and the ask makes
   *  sense. Asking at boot gets denied, and Android never prompts a
   *  second time. */
  | { kind: 'notify' }
  | { kind: 'done' }
  | { kind: 'error'; error: PairError }

/**
 * QR pairing entry point. Camera scanner → fingerprint visual confirm
 * → PAIRING: handshake → persisted DeviceRecord. On done redirects to
 * `/`, where the auto-connect flow picks up. Stage-to-view routing is
 * a plain switch; the presentational surface lives in
 * `pair.components.tsx`.
 */
export function PairScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [stage, setStage] = useState<PairStage>({ kind: 'scanning' })
  const router = useRouter()

  useEffect(() => {
    if (!permission) return
    if (!permission.granted && permission.canAskAgain) {
      void requestPermission()
    }
  }, [permission, requestPermission])

  const handleScan = useCallback(
    ({ data }: { data: string }) => {
      if (stage.kind !== 'scanning') return
      const payload = parsePairingQr(data)
      if (!payload) {
        setStage({
          kind: 'error',
          error: { kind: 'bad-qr', reason: 'Unrecognised QR content' },
        })
        return
      }
      setStage({ kind: 'confirm', payload })
    },
    [stage],
  )

  const startPairing = useCallback(async (payload: PairingQrPayload) => {
    setStage({ kind: 'pairing', payload })
    try {
      await completePairing(payload)
      setStage({ kind: shouldOfferPush($push.get()) ? 'notify' : 'done' })
    } catch (e) {
      setStage({ kind: 'error', error: mapPairErrorFromException(e) })
    }
  }, [])

  const answerNotify = useCallback(async (yes: boolean) => {
    if (yes) await enablePush()
    setStage({ kind: 'done' })
  }, [])

  if (stage.kind === 'done') return <Redirect href="/" />

  if (permission && !permission.granted && !permission.canAskAgain) {
    return (
      <PermissionBlockedStage
        {...(__DEV__
          ? { onOpenManualConnect: () => router.replace('/connect') }
          : {})}
      />
    )
  }

  return (
    <View className="bg-background flex-1">
      {stage.kind === 'scanning' && (
        <ScanStage
          hasPermission={permission?.granted ?? false}
          onScan={handleScan}
        />
      )}
      {stage.kind === 'notify' && (
        <NotifyStage
          onEnable={() => void answerNotify(true)}
          onSkip={() => void answerNotify(false)}
        />
      )}
      {stage.kind === 'confirm' && (
        <ConfirmStage
          payload={stage.payload}
          onConfirm={() => {
            void startPairing(stage.payload)
          }}
          onCancel={() => setStage({ kind: 'scanning' })}
        />
      )}
      {stage.kind === 'pairing' && (
        <PairingStage hint={stage.payload.device_hint} />
      )}
      {stage.kind === 'error' && (
        <ErrorStage
          error={stage.error}
          onRetry={() => setStage({ kind: 'scanning' })}
          {...(__DEV__
            ? { onOpenManualConnect: () => router.replace('/connect') }
            : {})}
        />
      )}
    </View>
  )
}

function mapPairErrorFromException(e: unknown): PairError {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('mismatch')) return { kind: 'pairing-token-expired' }
  if (msg.includes('timeout')) return { kind: 'timeout' }
  return { kind: 'connection-failed', reason: msg }
}
