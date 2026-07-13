import { useCameraPermissions } from 'expo-camera'
import { Redirect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  ConfirmStage,
  ErrorStage,
  PairingStage,
  PermissionBlockedStage,
  ScanStage,
} from './pair.components'
import { completePairing } from './pair.data'
import { parsePairingQr } from './pair.helpers'
import type { PairError, PairingQrPayload } from './pair.types'

type PairStage =
  | { kind: 'scanning' }
  | { kind: 'confirm'; payload: PairingQrPayload }
  | { kind: 'pairing'; payload: PairingQrPayload }
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
      setStage({ kind: 'done' })
    } catch (e) {
      setStage({ kind: 'error', error: mapPairErrorFromException(e) })
    }
  }, [])

  if (stage.kind === 'done') return <Redirect href="/" />

  if (permission && !permission.granted && !permission.canAskAgain) {
    return <PermissionBlockedStage />
  }

  return (
    <View className="flex-1 bg-background">
      {stage.kind === 'scanning' && (
        <ScanStage
          hasPermission={permission?.granted ?? false}
          onScan={handleScan}
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
          onOpenManualConnect={() => router.replace('/connect')}
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
