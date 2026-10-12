import * as SecureStore from 'expo-secure-store'
import { planDevicesMigration } from './$devices.migrate.helpers'

const V1_KEY = 'agent-terminal.device.v1'
const INDEX_KEY = 'agent-terminal.devices.index.v2'
const RECORD_PREFIX = 'agent-terminal.device.v2.'

/**
 * Move a pre-existing single record into the sharded v2 layout. Runs once
 * at boot, before the v2 load, and is a no-op on a fresh or already
 * migrated install.
 *
 * The v2 writes land before the v1 delete so a crash between them leaves
 * the user paired rather than logged out; the retry on next boot finds v1
 * still present and writes the same values again.
 */
export async function migrateDevicesV1ToV2(): Promise<void> {
  try {
    const plan = planDevicesMigration(await SecureStore.getItemAsync(V1_KEY))
    if (plan.kind === 'none') return
    if (plan.kind === 'migrate') {
      await SecureStore.setItemAsync(
        `${RECORD_PREFIX}${plan.deviceId}`,
        plan.record,
      )
      await SecureStore.setItemAsync(
        INDEX_KEY,
        JSON.stringify({ ids: [plan.deviceId], activeId: plan.deviceId }),
      )
    }
    await SecureStore.deleteItemAsync(V1_KEY)
  } catch {
    // Leave v1 in place; the next boot retries. A failed migration must
    // never block boot.
  }
}
