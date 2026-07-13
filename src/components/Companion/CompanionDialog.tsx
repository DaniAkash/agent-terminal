import { useStore } from '@nanostores/react'
import { Smartphone, Tablet, XCircle } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { $companion } from '@/modules/stores/$companion'
import {
  closeCompanionDialog,
  listenForPairingComplete,
  revokeDevice,
} from './companion.data'
import type { PairedDevice } from './companion.types'

/**
 * Two-part Companion dialog: pairing QR on top, paired devices list
 * below. Opens via `CompanionButton`, driven by the `$companion`
 * nano-store. On mount subscribes to the `pairing:complete` Tauri
 * event so a successful mobile pair immediately refreshes both the
 * displayed QR (with a fresh pairing token so the user can pair a
 * second device) and the devices list.
 */
export function CompanionDialog() {
  const { open, payload, devices, error, loading } = useStore($companion)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let unlisten: (() => void) | undefined
    void listenForPairingComplete().then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [open])

  const confirmTarget =
    confirmRevokeId !== null
      ? devices.find((d) => d.id === confirmRevokeId)
      : undefined

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            void closeCompanionDialog()
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pair a mobile device</DialogTitle>
            <DialogDescription>
              Scan the QR from Agent Terminal on your phone. Verify the
              fingerprint matches on both sides before confirming.
            </DialogDescription>
          </DialogHeader>

          <PairingSection payload={payload} error={error} loading={loading} />

          <div className="mt-4 border-border/60 border-t pt-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.16em]">
                Paired Devices
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {devices.length}
              </span>
            </div>
            <DevicesList
              devices={devices}
              onRevoke={(id) => setConfirmRevokeId(id)}
            />
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => closeCompanionDialog()}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmTarget !== undefined}
        onOpenChange={(next) => {
          if (!next) setConfirmRevokeId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke {confirmTarget?.device_name ?? 'this device'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This disconnects the device immediately. It won't be able to
              reconnect without pairing again from the QR here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmRevokeId(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const target = confirmRevokeId
                setConfirmRevokeId(null)
                if (target === null) return
                try {
                  await revokeDevice(target)
                } catch (_e) {}
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface PairingSectionProps {
  payload: ReturnType<typeof useStore<typeof $companion>>['payload']
  error: string | null
  loading: boolean
}

function PairingSection({ payload, error, loading }: PairingSectionProps) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-center text-[12px] text-destructive">
        <XCircle size={20} aria-hidden="true" />
        <span>{error}</span>
      </div>
    )
  }
  if (loading || payload === null) {
    return (
      <div className="flex h-[240px] items-center justify-center text-[12px] text-muted-foreground">
        Preparing pairing session…
      </div>
    )
  }
  const qrValue = JSON.stringify(payload)
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-md border border-border/60 bg-white p-3">
        <QRCodeSVG value={qrValue} size={192} level="M" />
      </div>
      <div className="w-full space-y-1 text-center">
        <div className="text-[11px] text-muted-foreground">
          Fingerprint (verify matches on your phone)
        </div>
        <output className="break-all font-mono text-[11px] text-foreground/80">
          {payload.fingerprint}
        </output>
      </div>
    </div>
  )
}

interface DevicesListProps {
  devices: PairedDevice[]
  onRevoke: (id: string) => void
}

function DevicesList({ devices, onRevoke }: DevicesListProps) {
  if (devices.length === 0) {
    return (
      <div className="rounded-md border border-border/40 border-dashed py-6 text-center text-[12px] text-muted-foreground">
        No devices paired yet.
      </div>
    )
  }
  return (
    <ul className="space-y-1">
      {devices.map((d) => (
        <DeviceRow key={d.id} device={d} onRevoke={onRevoke} />
      ))}
    </ul>
  )
}

interface DeviceRowProps {
  device: PairedDevice
  onRevoke: (id: string) => void
}

function DeviceRow({ device, onRevoke }: DeviceRowProps) {
  const Icon = device.platform === 'android' ? Tablet : Smartphone
  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/40">
      <Icon size={18} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-[12px]">
          {device.device_name}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {`Paired ${relativeTime(device.paired_at)} · Last seen ${relativeTime(
            device.last_seen,
          )}`}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-[11px] text-destructive/80 hover:text-destructive"
        onClick={() => onRevoke(device.id)}
      >
        Revoke
      </Button>
    </li>
  )
}

/**
 * Compact "5m ago" / "3d ago" formatter. Doesn't need i18n polish for
 * the desktop-side Companion dialog; the paired-at + last-seen fields
 * are advisory.
 */
function relativeTime(unixSeconds: number): string {
  const nowSec = Math.floor(Date.now() / 1000)
  const delta = Math.max(0, nowSec - unixSeconds)
  if (delta < 60) return 'just now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h ago`
  return `${Math.floor(delta / 86_400)}d ago`
}
