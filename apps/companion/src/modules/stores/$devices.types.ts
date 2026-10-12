/**
 * Type-only satellite for the device shapes. Kept separate from
 * `$devices.ts` so the pure helpers in `$devices.helpers.ts` can
 * import them without pulling react-native / expo-secure-store into
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

/**
 * Non-secret index of paired desktops. Stored apart from the records
 * themselves because expo-secure-store is key-value only and documents
 * that iOS has historically rejected values over roughly 2048 bytes:
 * one blob holding every record would grow into that ceiling as more
 * desktops are paired.
 */
export interface DevicesIndex {
  ids: string[]
  activeId: string | null
}

export interface DevicesState {
  loaded: boolean
  byId: Record<string, DeviceRecord>
  activeId: string | null
}
