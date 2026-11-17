import { useStore } from '@nanostores/react'
import { Check, Smartphone, Tablet, X, XCircle } from 'lucide-react'
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
  $pairingApproval,
  APPROVAL_TIMEOUT_MS,
  type PendingPairingApproval,
  respondPairingApproval,
} from '@/modules/stores/$pairingApproval'
import {
  closeCompanionDialog,
  listenForPairingComplete,
  revokeDevice,
} from './companion.data'
import { addressLine, deviceLine, isCgnatIpv4 } from './companion.helpers'
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
  const pending = useStore($pairingApproval)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    // Race window: `listenForPairingComplete()` resolves
    // asynchronously with the unlisten fn. If the dialog closes
    // before that resolves, the previous cleanup runs while
    // `unlisten` is still undefined, and the listener registers
    // later with no way to remove it — one leaked subscription per
    // fast open/close cycle. The `cancelled` flag closes the gap:
    // cleanup flips it, and either the pending .then() disposes the
    // listener immediately on arrival OR the cleanup calls the
    // now-set `unlisten`.
    void listenForPairingComplete().then((fn) => {
      if (cancelled) {
        fn()
      } else {
        unlisten = fn
      }
    })
    return () => {
      cancelled = true
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {pending
                ? `${pending.deviceName} wants to pair`
                : 'Pair a mobile device'}
            </DialogTitle>
            <DialogDescription>
              {pending
                ? 'Approve only if this is your phone and it shows the same fingerprint.'
                : 'Scan the QR from Agent Terminal on your phone. Verify the fingerprint matches on both sides before confirming.'}
            </DialogDescription>
          </DialogHeader>

          {pending ? (
            <PendingApprovalView
              pending={pending}
              fingerprint={payload?.fingerprint}
            />
          ) : (
            <PairingSection payload={payload} error={error} loading={loading} />
          )}

          <div className="border-border/60 mt-4 min-w-0 border-t pt-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-muted-foreground text-[11px] font-semibold tracking-[0.16em] uppercase">
                Paired Devices
              </h3>
              <span className="text-muted-foreground text-[11px]">
                {devices.length}
              </span>
            </div>
            <DevicesList
              devices={devices}
              onRevoke={(id) => setConfirmRevokeId(id)}
            />
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                void closeCompanionDialog()
              }}
            >
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
                  // Clear any prior error surface on success so a
                  // stale message from a previous action does not
                  // linger in the dialog.
                  $companion.setKey('error', null)
                } catch (e) {
                  // Surface the failure inline via the existing
                  // $companion.error field so the user sees a real
                  // "revoke failed" instead of the confirm dialog
                  // just disappearing silently.
                  $companion.setKey(
                    'error',
                    `Revoke failed: ${e instanceof Error ? e.message : String(e)}`,
                  )
                }
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

function PendingApprovalView({
  pending,
  fingerprint,
}: {
  pending: PendingPairingApproval
  fingerprint: string | undefined
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [])

  const remainingMs = Math.max(0, pending.expiresAt - now)
  const pct = Math.min(100, (remainingMs / APPROVAL_TIMEOUT_MS) * 100)
  const remainingSec = Math.ceil(remainingMs / 1000)
  const isTablet = /ipad|tablet/i.test(
    `${pending.platform} ${pending.model ?? ''}`,
  )
  const DeviceIcon = isTablet ? Tablet : Smartphone
  const address = addressLine(pending.peerIp)

  return (
    <div className="border-primary/30 bg-primary/5 flex flex-col gap-4 rounded-lg border p-5">
      {/* The identity the phone sent and the address it came from: the
          same name, model and route the phone shows on its waiting
          sheet, so the person approving can match the two. */}
      <div className="border-border/60 flex items-start gap-3 rounded-md border p-3">
        <div className="bg-primary/15 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
          <DeviceIcon className="size-5" />
        </div>
        <div className="min-w-0 space-y-0.5 text-left">
          <div className="text-foreground text-[14px] font-semibold">
            {pending.deviceName}
          </div>
          <div className="text-muted-foreground text-[12px]">
            {deviceLine(pending.platform, pending.model)}
          </div>
          {address && (
            <div className="text-muted-foreground text-[12px]">{address}</div>
          )}
          {fingerprint && (
            <div className="text-muted-foreground font-mono text-[11px] break-all">
              Fingerprint {fingerprint}
            </div>
          )}
        </div>
      </div>

      <div className="w-full space-y-1.5">
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-primary h-full transition-[width] duration-200 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-muted-foreground text-[11px]">
          {pending.responding
            ? 'Completing handshake…'
            : `${remainingSec} s left. The phone shows the same countdown.`}
        </div>
      </div>

      <div className="flex w-full items-center justify-end gap-2.5">
        <Button
          variant="outline"
          disabled={pending.responding}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 gap-1.5"
          onClick={() => void respondPairingApproval(pending.requestId, false)}
        >
          <X className="size-4" />
          Decline
        </Button>
        <Button
          disabled={pending.responding}
          className="gap-1.5"
          onClick={() => void respondPairingApproval(pending.requestId, true)}
        >
          <Check className="size-4" />
          Approve
        </Button>
      </div>
    </div>
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
      <div className="border-destructive/40 bg-destructive/10 text-destructive flex flex-col items-center gap-2 rounded-md border p-4 text-center text-[12px]">
        <XCircle size={20} aria-hidden="true" />
        <span>{error}</span>
      </div>
    )
  }
  if (loading || payload === null) {
    return (
      <div className="text-muted-foreground flex h-[240px] items-center justify-center text-[12px]">
        Preparing pairing session…
      </div>
    )
  }
  const qrValue = JSON.stringify(payload)
  const isTailscaleActive =
    Boolean(payload.tailscale_host) || payload.ips.some(isCgnatIpv4)

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="border-border/60 rounded-md border bg-white p-3">
        <QRCodeSVG value={qrValue} size={192} level="M" />
      </div>
      {isTailscaleActive && (
        <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span>Tailscale mesh active</span>
          {payload.tailscale_host && (
            <span className="text-muted-foreground text-[10px]">
              ({payload.tailscale_host})
            </span>
          )}
        </div>
      )}
      <div className="w-full space-y-1 text-center">
        <div className="text-muted-foreground text-[11px]">
          Fingerprint (verify matches on your phone)
        </div>
        <Fingerprint value={payload.fingerprint} />
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
      <div className="border-border/40 text-muted-foreground rounded-md border border-dashed py-6 text-center text-[12px]">
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
  const address = addressLine(device.last_ip)
  return (
    <li className="hover:bg-accent/40 flex items-center gap-3 rounded-md px-2 py-2">
      <Icon size={18} className="text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium">
          {device.device_name}
        </div>
        <div className="text-muted-foreground truncate text-[11px]">
          {deviceLine(device.platform, device.model)}
        </div>
        {address && (
          <div className="text-muted-foreground truncate text-[11px]">
            {address}
          </div>
        )}
        <div className="text-muted-foreground truncate text-[11px]">
          {`Paired ${relativeTime(device.paired_at)} · Last seen ${relativeTime(device.last_seen)}`}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive/80 hover:text-destructive text-[11px]"
        onClick={() => onRevoke(device.id)}
      >
        Revoke
      </Button>
    </li>
  )
}

/**
 * Fingerprint block matching the Android pair screen's layout: eight
 * 4-pair blocks laid out in a wrapping flex row. On the desktop's
 * `max-w-md` dialog this settles into two rows of four (matching the
 * mobile side) at `text-xs` monospace; on narrower screens flex-wrap
 * folds it to more rows of two rather than truncating.
 *
 * `whitespace-nowrap` on each span keeps a single block atomic (the
 * colons within are never split), and `tabular-nums` fixes the digit
 * widths so vertical scanning against the phone lines up column by
 * column.
 */
function Fingerprint({ value }: { value: string }) {
  const pairs = value.split(':')
  const blocks: string[] = []
  for (let i = 0; i < pairs.length; i += 4) {
    blocks.push(pairs.slice(i, i + 4).join(':'))
  }
  return (
    <output className="text-foreground/90 mx-auto block max-w-full font-mono text-[12px] tabular-nums">
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        {blocks.map((block) => (
          <span key={block} className="whitespace-nowrap">
            {block}
          </span>
        ))}
      </div>
    </output>
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
