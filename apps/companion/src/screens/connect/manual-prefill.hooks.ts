import { useEffect } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { loadPairingConfig } from '@/modules/env/dev-config'
import type { ConnectInputs, ConnectOutputs } from './connect.schemas'

/**
 * Restore previously entered manual credentials into the form.
 *
 * Split out of the data hook so that hook stays a thin submit path: the
 * load is asynchronous, which forces an effect, and effects are the part
 * of this screen least worth re-reading when the submit logic changes.
 *
 * The `cancelled` guard covers unmount during the load so `form.reset`
 * is never called on a stale form. An effect is unavoidable here because
 * the value arrives asynchronously from a store outside React.
 */
export function useManualPrefill(
  form: UseFormReturn<ConnectInputs, unknown, ConnectOutputs>,
): void {
  useEffect(() => {
    let cancelled = false
    loadPairingConfig()
      .then(({ url, token, fingerprint }) => {
        if (cancelled) return
        form.reset({
          url: url ?? '',
          token: token ?? '',
          fingerprint: fingerprint ?? '',
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('[connect] loadPairingConfig failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [form])
}
