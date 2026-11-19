/**
 * Words the desktop uses for a phone, shared by the approval prompt, the
 * paired devices list, the indicator tooltip and the toasts, so all four
 * describe the same phone the same way and match what the phone itself
 * shows (the Companion State Map vocabulary).
 */

/** How a phone reaches this desktop. The phone's route pill uses the same two names. */
export type Route = 'Tailscale' | 'Wi-Fi'

/**
 * Route of a connection, read from the address the phone connects from.
 *
 * 100.64.0.0/10 (RFC 6598) is the range Tailscale assigns from, and
 * fd7a:115c:a1e0::/48 its IPv6 range. The IPv4 range is also ordinary
 * carrier-grade NAT, but a phone cannot reach this desktop from a CGNAT
 * address it does not share, so for a connection that arrived it means
 * the tailnet. Everything else is the local network.
 */
export function routeOfAddress(ip: string | undefined | null): Route | null {
  if (!ip) return null
  const v4 = ip.replace(/^::ffff:/i, '')
  if (isCgnatIpv4(v4)) return 'Tailscale'
  if (/^fd7a:115c:a1e0:/i.test(ip)) return 'Tailscale'
  return 'Wi-Fi'
}

/** True for an IPv4 address in 100.64.0.0/10. */
export function isCgnatIpv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const [a, b] = parts.map(Number)
  return a === 100 && (b & 0b1100_0000) === 64
}

/** "android" → "Android", "ios" → "iOS"; anything else as it came. */
export function platformLabel(platform: string): string {
  if (platform.toLowerCase() === 'ios') return 'iOS'
  if (platform.toLowerCase() === 'android') return 'Android'
  if (platform.toLowerCase() === 'mobile') return 'Mobile'
  return platform
}

/** "SM-M526B · Android": the model (when the phone sent one) and the platform. */
export function deviceLine(platform: string, model?: string | null): string {
  const name = platformLabel(platform)
  return model ? `${model} · ${name}` : name
}

/** "100.64.0.7 · Tailscale", or null when the address is not known. */
export function addressLine(ip: string | undefined | null): string | null {
  const route = routeOfAddress(ip)
  if (!ip || !route) return null
  return `${ip.replace(/^::ffff:/i, '')} · ${route}`
}
