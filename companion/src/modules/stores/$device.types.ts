/**
 * Type-only satellite for the DeviceRecord shape. Kept separate from
 * `$device.ts` so the pure shape-guard in `$device.helpers.ts` can
 * import it without pulling react-native / expo-secure-store into
 * bun test's module graph.
 */
export interface DeviceRecord {
  token: string
  deviceId: string
  host?: string
  ips: string[]
  port: number
  fingerprint: string
  deviceHint: string
  lastIp: string | null
  lastPort: number | null
}
