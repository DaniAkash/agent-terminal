import { zodResolver } from '@hookform/resolvers/zod'
import { useStore } from '@nanostores/react'
import { useForm } from 'react-hook-form'
import { savePairingConfig } from '@/modules/env/dev-config'
import { saveDeviceToSecureStore } from '@/modules/stores/$device'
import { $session } from '@/modules/stores/$session'
import { disconnect } from '@/modules/wss/client'
import {
  type ConnectInputs,
  type ConnectOutputs,
  connectSchema,
} from './connect.schemas'
import { deviceRecordFromManualInput } from './manual-pairing.helpers'
import { useManualPrefill } from './manual-prefill.hooks'

export function useConnectData() {
  const session = useStore($session)
  const form = useForm<ConnectInputs, unknown, ConnectOutputs>({
    resolver: zodResolver(connectSchema),
    defaultValues: { url: '', token: '', fingerprint: '' },
    mode: 'onSubmit',
  })

  useManualPrefill(form)

  const onSubmit = form.handleSubmit(async (data) => {
    // The pinned socket refuses to construct without a device record
    // carrying a fingerprint, so the manual path persists one just as the
    // QR path does. Same shape, same store; only the source differs.
    const record = deviceRecordFromManualInput(
      data.url,
      data.token,
      data.fingerprint,
    )
    if (!record) {
      form.setError('url', { message: 'Expected wss://host:port/stream' })
      return
    }

    // Drop any live socket first. Persisting the record wakes the
    // $device subscriber in the wss bootstrap, which runs autoConnect
    // against the resolver ladder; that subscriber skips while a socket
    // is already connected or negotiating, so a resubmit with new
    // credentials would otherwise be silently ignored.
    disconnect()

    try {
      await Promise.all([
        savePairingConfig(data.url, data.token, data.fingerprint),
        saveDeviceToSecureStore(record),
      ])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[connect] saving manual pairing failed:', err)
      form.setError('root', { message: `Failed to save credentials, ${msg}` })
      return
    }
    // No direct connect() here on purpose. The subscriber owns the single
    // connection path, so the resolver cannot race a socket this handler
    // opened behind its back.
  })

  return {
    form,
    onSubmit,
    status: session.status,
    serverError: session.lastError,
  }
}
