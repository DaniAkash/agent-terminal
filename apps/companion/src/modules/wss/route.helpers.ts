/**
 * Which way a connection runs, named the way the desktop names it: the
 * Companion State Map has one word for each route on both sides.
 */
export type Route = 'tailscale' | 'wifi'

/**
 * Route of a host the phone dials.
 *
 * A MagicDNS name (`*.ts.net`) or an address in 100.64.0.0/10, the range
 * Tailscale assigns from, is the tailnet. Everything else in a pairing QR
 * is a local-network name or address (`.local`, RFC 1918), which is Wi-Fi
 * from the phone's side.
 */
export function routeOfHost(host: string): Route {
  const lower = host.toLowerCase().replace(/\.$/, '')
  if (lower.endsWith('.ts.net')) return 'tailscale'
  return isTailnetIpv4(lower) ? 'tailscale' : 'wifi'
}

/** Route of a `wss://host:port/...` URL, or null for another shape. */
export function routeOfUrl(url: string | null | undefined): Route | null {
  const host = hostOfUrl(url)
  return host ? routeOfHost(host) : null
}

/** Host part of a `wss://host:port/...` URL. */
export function hostOfUrl(url: string | null | undefined): string | null {
  if (!url) return null
  return /^wss?:\/\/([^:/]+)(?::\d+)?(?:\/|$)/.exec(url)?.[1] ?? null
}

/** The word on the pill: "Tailscale" or "Wi-Fi". */
export function routeLabel(route: Route): string {
  return route === 'tailscale' ? 'Tailscale' : 'Wi-Fi'
}

function isTailnetIpv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) {
    return false
  }
  const [a, b] = parts.map(Number)
  return a === 100 && b !== undefined && b >= 64 && b <= 127
}
