import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { $companion } from '@/modules/stores/$companion'
import type { PairedDevice, PairingQrPayload } from './companion.types'

/**
 * Open the Companion dialog. Mints a fresh pairing token via
 * `open_pairing_window`, refreshes the paired-devices list, and flips
 * the store's `open` flag. Fails gracefully into the `error` field so
 * the dialog can surface it inline (e.g. TLS disabled, WSS bind
 * failed at startup).
 */
export async function openCompanionDialog(): Promise<void> {
  $companion.setKey('open', true)
  $companion.setKey('loading', true)
  $companion.setKey('error', null)
  try {
    const [payload, devices] = await Promise.all([
      invoke<PairingQrPayload>('open_pairing_window'),
      invoke<PairedDevice[]>('list_paired_devices'),
    ])
    $companion.setKey('payload', payload)
    $companion.setKey('devices', devices)
  } catch (e) {
    $companion.setKey('error', String(e))
    $companion.setKey('payload', null)
  } finally {
    $companion.setKey('loading', false)
  }
}

/**
 * Close the Companion dialog and clear the pairing token server-side.
 * The desktop is safe if this call fails: the 5-minute TTL will
 * expire the token anyway. Best-effort.
 */
export async function closeCompanionDialog(): Promise<void> {
  $companion.setKey('open', false)
  $companion.setKey('payload', null)
  try {
    await invoke('close_pairing_window')
  } catch (_e) {}
}

/**
 * Refresh only the paired-devices list. Called on `pairing:complete`
 * events + after a successful Revoke.
 */
export async function refreshDevices(): Promise<void> {
  try {
    const devices = await invoke<PairedDevice[]>('list_paired_devices')
    $companion.setKey('devices', devices)
  } catch (_e) {}
}

/**
 * Revoke a paired device. Returns the number of active WSS sessions
 * the server force-closed as a result (0 if the device was offline).
 * Refreshes the local devices list on success.
 */
export async function revokeDevice(deviceId: string): Promise<number> {
  const closed = await invoke<number>('revoke_paired_device', {
    deviceId,
  })
  await refreshDevices()
  return closed
}

/**
 * Listen for the desktop-side `pairing:complete` event the server
 * emits after a successful pair. Refreshes both the QR payload
 * (mints a fresh pairing token so the dialog can immediately pair
 * another device) and the devices list.
 *
 * Returns the unlisten function; callers unregister on unmount.
 */
export async function listenForPairingComplete(): Promise<UnlistenFn> {
  return listen('pairing:complete', async () => {
    await refreshDevices()
    try {
      const payload = await invoke<PairingQrPayload>('open_pairing_window')
      $companion.setKey('payload', payload)
    } catch (_e) {}
  })
}
