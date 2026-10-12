import { isDeviceRecord } from './$devices.helpers'
export type MigrationPlan =
  | { kind: 'none' }
  | { kind: 'drop' }
  | { kind: 'migrate'; deviceId: string; record: string }

/**
 * Decide what the v1 to v2 move should do, as data, so the ordering the
 * caller executes can be asserted without a SecureStore double.
 *
 * A corrupt v1 blob plans a bare `drop`: the previous loader also treated
 * an unparseable record as "no record", so the user re-pairs either way
 * and carrying half a record into v2 would only hide the problem.
 */
export function planDevicesMigration(rawV1: string | null): MigrationPlan {
  if (!rawV1) return { kind: 'none' }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawV1)
  } catch {
    return { kind: 'drop' }
  }
  if (!isDeviceRecord(parsed)) return { kind: 'drop' }
  return { kind: 'migrate', deviceId: parsed.deviceId, record: rawV1 }
}
