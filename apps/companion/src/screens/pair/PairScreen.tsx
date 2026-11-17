import { useCameraPermissions } from 'expo-camera'
import { Redirect, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, View } from 'react-native'
import { $push, enablePush } from '@/modules/push'
import { clearRemoval } from '@/modules/stores/$removal'
import {
  ConfirmStage,
  ErrorStage,
  NotifySheet,
  PermissionBlockedStage,
  ReachingSheet,
  ResultStage,
  ScanStage,
  WaitingSheet,
} from './pair.components'
import {
  completePairing,
  deviceMeta,
  type PairFailure,
  PairingFailed,
  type WaitingInfo,
} from './pair.data'
import {
  CanceledError,
  initialTries,
  type PairTry,
  buildPairingAttemptUrls,
  parsePairingQr,
  shouldOfferPush,
} from './pair.helpers'
import type { PairError, PairingQrPayload } from './pair.types'

type PairStage =
  /** `note` replaces the instructions, e.g. after the person canceled. */
  | { kind: 'scanning'; note?: string }
  | { kind: 'confirm'; payload: PairingQrPayload }
  | {
      kind: 'reaching'
      payload: PairingQrPayload
      tries: PairTry[]
      startedAt: number
    }
  | { kind: 'waiting'; payload: PairingQrPayload; info: WaitingInfo }
  /** Offer push, now that the user has a desktop and the ask makes
   *  sense. Asking at boot gets denied, and Android never prompts a
   *  second time. */
  | { kind: 'notify'; payload: PairingQrPayload }
  | { kind: 'done' }
  | { kind: 'result'; payload: PairingQrPayload; failure: PairFailure }
  | { kind: 'error'; error: PairError }

const CANCELED_NOTE = 'Request canceled. Scan the QR to try again.'

/**
 * QR pairing: Scanning → Confirming → Reaching desktop → Waiting for
 * approval → Paired, or one of the ended states (Declined, Canceled,
 * Timed out, QR expired, Unreachable). The middle three are sheets over
 * the scanner; leaving the app or canceling withdraws the request at
 * once and returns to Scanning. On done redirects to `/`, where the
 * auto-connect flow picks up.
 */
export function PairScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [stage, setStage] = useState<PairStage>({ kind: 'scanning' })
  const attempt = useRef<AbortController | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (!permission) return
    if (!permission.granted && permission.canAskAgain) {
      void requestPermission()
    }
  }, [permission, requestPermission])

  const cancelAttempt = useCallback(() => {
    attempt.current?.abort()
    attempt.current = null
  }, [])

  // Leaving the app is a decision too: the request is withdrawn at once
  // (the desktop prompt closes) and the phone is back on the scanner when
  // it returns, instead of a "Pairing with…" screen for a request that is
  // no longer pending anywhere. useEffect exception: an external event
  // source (AppState), subscribed while a request is in flight.
  const inFlight = stage.kind === 'reaching' || stage.kind === 'waiting'
  useEffect(() => {
    if (!inFlight) return
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') cancelAttempt()
    })
    return () => sub.remove()
  }, [inFlight, cancelAttempt])

  // Unmounting (Back) withdraws the request as well.
  useEffect(() => cancelAttempt, [cancelAttempt])

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

  const startPairing = useCallback(
    async (payload: PairingQrPayload) => {
      cancelAttempt()
      const controller = new AbortController()
      attempt.current = controller
      const startedAt = Date.now()
      setStage({
        kind: 'reaching',
        payload,
        tries: initialTries(buildPairingAttemptUrls(payload)),
        startedAt,
      })
      // Every update is for this attempt only; a canceled one says nothing.
      const current = () => attempt.current === controller
      try {
        await completePairing(payload, {
          signal: controller.signal,
          onReaching: (tries) => {
            if (current()) {
              setStage({ kind: 'reaching', payload, tries, startedAt })
            }
          },
          onWaiting: (info) => {
            if (current()) setStage({ kind: 'waiting', payload, info })
          },
        })
        if (!current()) return
        attempt.current = null
        clearRemoval()
        setStage(
          shouldOfferPush($push.get())
            ? { kind: 'notify', payload }
            : { kind: 'done' },
        )
      } catch (e) {
        if (e instanceof CanceledError) {
          // Unless a newer attempt (Try again) is what canceled this one.
          if (attempt.current === null) {
            setStage({ kind: 'scanning', note: CANCELED_NOTE })
          }
          return
        }
        if (!current()) return
        attempt.current = null
        setStage(
          e instanceof PairingFailed
            ? { kind: 'result', payload, failure: e.failure }
            : {
                kind: 'error',
                error: {
                  kind: 'unknown',
                  reason: e instanceof Error ? e.message : String(e),
                },
              },
        )
      }
    },
    [cancelAttempt],
  )

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

  const scanAgain = () => setStage({ kind: 'scanning' })
  const hasCamera = permission?.granted ?? false

  switch (stage.kind) {
    case 'confirm':
      return (
        <ConfirmStage
          payload={stage.payload}
          meta={deviceMeta()}
          onConfirm={() => void startPairing(stage.payload)}
          onCancel={scanAgain}
        />
      )
    case 'result':
      return (
        <ResultStage
          failure={stage.failure}
          desk={stage.payload.device_hint}
          onScanAgain={scanAgain}
          onTryAgain={() => void startPairing(stage.payload)}
        />
      )
    case 'error':
      return (
        <ErrorStage
          error={stage.error}
          onRetry={scanAgain}
          {...(__DEV__
            ? { onOpenManualConnect: () => router.replace('/connect') }
            : {})}
        />
      )
    case 'scanning':
      return (
        <View className="bg-background flex-1">
          <ScanStage
            hasPermission={hasCamera}
            onScan={handleScan}
            note={stage.note}
          />
        </View>
      )
    case 'reaching':
      return (
        <ScanStage hasPermission={hasCamera}>
          <ReachingSheet
            desk={stage.payload.device_hint}
            tries={stage.tries}
            startedAt={stage.startedAt}
            onCancel={cancelAttempt}
          />
        </ScanStage>
      )
    case 'waiting':
      return (
        <ScanStage hasPermission={hasCamera}>
          <WaitingSheet
            desk={stage.payload.device_hint}
            info={stage.info}
            onCancel={cancelAttempt}
          />
        </ScanStage>
      )
    case 'notify':
      return (
        <ScanStage hasPermission={hasCamera}>
          <NotifySheet
            desk={stage.payload.device_hint}
            onEnable={() => void answerNotify(true)}
            onSkip={() => void answerNotify(false)}
          />
        </ScanStage>
      )
  }
}
