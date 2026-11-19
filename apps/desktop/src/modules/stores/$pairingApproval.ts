import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { atom } from 'nanostores'
import { toast } from 'sonner'
import { routeOfAddress } from '@/components/Companion/companion.helpers'
import { $companion } from '@/modules/stores/$companion'

/** Mirrors Rust `PAIRING_APPROVAL_TIMEOUT` in wss_server.rs. */
export const APPROVAL_TIMEOUT_MS = 60_000

export interface PendingPairingApproval {
  requestId: string
  deviceName: string
  platform: string
  model?: string
  /** Address the request came from; older desktops' events lack it. */
  peerIp?: string
  expiresAt: number
  responding: boolean
}

/** The pairing request currently awaiting a desktop decision, if any. */
export const $pairingApproval = atom<PendingPairingApproval | null>(null)

let listenerInstalled = false

interface PairingRequestEventPayload {
  request_id: string
  device_name: string
  platform: string
  model?: string
  peer_ip?: string
}

interface PairingCompletePayload {
  device_name?: string
  peer_ip?: string
}

interface PairingApprovalClosedPayload {
  request_id: string
  reason?: string
}

function toastIdFor(requestId: string): string {
  return `pairing-approval-${requestId}`
}

function dismissApprovalToast(requestId: string): void {
  toast.dismiss(toastIdFor(requestId))
}

/**
 * Clear a settled request and drop its toast. The store is written first:
 * Sonner calls `onDismiss` for programmatic dismissals too, and that handler
 * declines any request that is still pending.
 */
function clearPending(requestId: string): void {
  if ($pairingApproval.get()?.requestId === requestId) {
    $pairingApproval.set(null)
  }
  dismissApprovalToast(requestId)
}

function showApprovalToast(item: PendingPairingApproval): void {
  const id = toastIdFor(item.requestId)
  const modelInfo = item.model ? ` (${item.model})` : ''

  toast(`Pairing request: ${item.deviceName}${modelInfo}`, {
    id,
    description: `${item.platform} device wants to connect to Agent Terminal.`,
    duration: Infinity,
    action: {
      label: 'Approve',
      onClick: () => {
        void respondPairingApproval(item.requestId, true)
      },
    },
    cancel: {
      label: 'Decline',
      onClick: () => {
        void respondPairingApproval(item.requestId, false)
      },
    },
    onDismiss: () => {
      // Only treat as rejection when the user manually closed the toast, not
      // when we dismissed it programmatically (modal opened, or the request
      // was already answered or cleared).
      if ($companion.get().open) return
      const pending = $pairingApproval.get()
      if (pending?.requestId === item.requestId && !pending.responding) {
        void respondPairingApproval(item.requestId, false)
      }
    },
  })
}

/**
 * Single entry point for approving or declining a pending pairing request.
 * Keeps `$pairingApproval`, the Sonner toast, and the Rust backend in sync.
 */
export async function respondPairingApproval(
  requestId: string,
  approved: boolean,
): Promise<void> {
  const current = $pairingApproval.get()
  if (current?.requestId === requestId) {
    if (current.responding) return
    $pairingApproval.set({ ...current, responding: true })
  }

  dismissApprovalToast(requestId)

  try {
    await invoke('respond_pairing_approval', {
      requestId,
      approved,
    })
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: a lost approval response leaves the phone waiting, which needs a breadcrumb in devtools
    console.error('Failed to respond to pairing approval:', err)
  }
  if ($pairingApproval.get()?.requestId === requestId) {
    $pairingApproval.set(null)
  }
}

/** Install the app-lifetime pairing approval listeners. Idempotent. */
export function installPairingApprovalListener(): void {
  if (listenerInstalled) return
  listenerInstalled = true

  // Keep toast & modal mutually exclusive so the user never sees two competing
  // prompts for the same request. Only opening matters: closing the dialog
  // closes the pairing window, which cancels the pending request, so there
  // is nothing left for a toast to ask.
  $companion.listen((state, oldState) => {
    const pending = $pairingApproval.get()
    if (pending && !pending.responding && state.open && !oldState?.open) {
      dismissApprovalToast(pending.requestId)
    }
  })

  const on = <T>(event: string, handler: (payload: T) => void) => {
    void listen<T>(event, (e) => handler(e.payload))
  }

  on<PairingRequestEventPayload>('pairing:request_approval', (payload) => {
    const item: PendingPairingApproval = {
      requestId: payload.request_id,
      deviceName: payload.device_name,
      platform: payload.platform,
      model: payload.model,
      peerIp: payload.peer_ip,
      expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
      responding: false,
    }
    $pairingApproval.set(item)
    // Only show the toast if the Companion modal is not currently open.
    if (!$companion.get().open) showApprovalToast(item)
  })

  on<PairingApprovalClosedPayload>(
    'pairing:approval_closed',
    ({ request_id, reason }) => {
      const pending = $pairingApproval.get()
      clearPending(request_id)
      if (pending?.requestId === request_id && reason === 'timeout') {
        toast.warning('Pairing request timed out', {
          description: `${pending.deviceName} was not approved within ${APPROVAL_TIMEOUT_MS / 1000} s.`,
          duration: 4000,
        })
      }
    },
  )

  on<PairingCompletePayload>('pairing:complete', (payload) => {
    const pending = $pairingApproval.get()
    if (pending) clearPending(pending.requestId)
    // The phone's own name, as the prompt showed it. An older desktop
    // build sends no payload; the pending request still knows the name.
    const name = payload?.device_name ?? pending?.deviceName
    const route = routeOfAddress(payload?.peer_ip ?? pending?.peerIp)
    toast.success(name ? `${name} paired` : 'Mobile device paired', {
      description: route ? `Connected over ${route}` : undefined,
      duration: 3000,
    })
  })
}
