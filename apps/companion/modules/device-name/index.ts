import { requireOptionalNativeModule } from 'expo'

interface DeviceNameModule {
  get(): string | null
}

/**
 * The name the owner gave this device, e.g. "Galaxy M52 5G", or null
 * when the platform does not say (or the native module is missing, as in
 * a build made before it existed).
 */
export function deviceFriendlyName(): string | null {
  try {
    const name =
      requireOptionalNativeModule<DeviceNameModule>('DeviceName')?.get()
    return name?.trim() ? name.trim() : null
  } catch {
    return null
  }
}
