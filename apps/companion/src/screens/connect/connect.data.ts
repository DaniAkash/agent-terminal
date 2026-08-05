import { zodResolver } from '@hookform/resolvers/zod'
import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { loadPairingConfig, savePairingConfig } from '@/modules/env/dev-config'
import { $session } from '@/modules/stores/$session'
import { connect } from '@/modules/wss/client'
import {
  type ConnectInputs,
  type ConnectOutputs,
  connectSchema,
} from './connect.schemas'

export function useConnectData() {
  const session = useStore($session)
  const form = useForm<ConnectInputs, unknown, ConnectOutputs>({
    resolver: zodResolver(connectSchema),
    defaultValues: { url: '', token: '' },
    mode: 'onSubmit',
  })

  // Async prefill from persisted config on mount. `cancelled` guard
  // handles the unmount-during-load race so we don't call form.reset
  // on a stale form. useEffect over the render-time gate-flag idiom
  // because the resolution happens asynchronously — CLAUDE.md's
  // useEffect exception for "syncing to a store outside React" fits.
  useEffect(() => {
    let cancelled = false
    loadPairingConfig()
      .then(({ url, token }) => {
        if (cancelled) return
        form.reset({ url: url ?? '', token: token ?? '' })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('[connect] loadPairingConfig failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [form])

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await savePairingConfig(data.url, data.token)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[connect] savePairingConfig failed:', err)
      form.setError('root', { message: `Failed to save credentials, ${msg}` })
      return
    }
    connect(data.url, data.token)
  })

  return {
    form,
    onSubmit,
    status: session.status,
    serverError: session.lastError,
  }
}
