import type { DeviceRecord } from '@/modules/stores/$devices'

/**
 * Self-healing WSS resolver ladder. Given a DeviceRecord (from
 * `$activeDevice`), returns the sequence of `wss://` URLs the client
 * should try, in order, when opening a connection. First success
 * wins; `client.ts` iterates through them until one auth-completes
 * or all fail.
 *
 * The ladder rungs:
 *
 * 1. **Cached IP + cached port** — steady-state fast path.
 * 2. **Named hosts + cached port** — Tailscale MagicDNS first (works
 *    off-LAN over the mesh), then `.local` (handles a same-LAN IP
 *    change: DHCP renewal, network switch). System resolver on both
 *    iOS and Android handles mDNS `.local` transparently, so no
 *    dev-client zeroconf plugin is required.
 * 3. **Named hosts + each of the three standard ports** — handles a
 *    desktop reboot that landed on a different port from the trio.
 *    Port by port, both names per port, so a dead tailnet path costs a
 *    same-LAN phone one extra probe per port, not three up front.
 *    `push` dedupes, so the port already tried at rung 2 is skipped.
 * 4. **QR-known IPs + each standard port** — belt-and-suspenders
 *    for the case where the phone's mDNS resolution is broken
 *    (some carriers block .local, some corporate WiFi disables
 *    mDNS entirely). Falls back to whatever IPs the QR carried.
 *
 * Callers apply a 2s per-attempt timeout and try the candidates one at
 * a time, so a ladder where everything fails takes 2s per candidate:
 * about 24s for a desktop with a Tailscale name, a `.local` name and
 * two addresses (12 candidates).
 */

/** Standardised WSS port trio. Must match Rust `net::STANDARD_PORTS`. */
// fallow-ignore-next-line unused-export
export const STANDARD_PORTS: readonly number[] = [47823, 28617, 39482]

export function resolveWssCandidates(device: DeviceRecord): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()

  // Every candidate is wss://. PinnedWebSocket rejects other schemes,
  // so a ws:// entry here would never open; symmetric with
  // buildPairingAttemptUrls in pair.helpers.ts.
  const push = (host: string | undefined, port: number) => {
    if (!host) return
    const url = `wss://${host}:${port}/stream`
    if (seen.has(url)) return
    seen.add(url)
    candidates.push(url)
  }

  const cachedPort = device.lastPort ?? device.port
  const namedHosts = [device.tailscaleHost, device.host]

  // Rung 1: cached IP + cached port.
  push(device.lastIp ?? device.ips[0], cachedPort)
  // Rung 2: named hosts + cached port.
  for (const host of namedHosts) push(host, cachedPort)
  // Rung 3: named hosts + each standard port.
  for (const p of STANDARD_PORTS) for (const host of namedHosts) push(host, p)
  // Rung 4: QR-known IPs + each standard port.
  for (const ip of device.ips) for (const p of STANDARD_PORTS) push(ip, p)

  return candidates
}

/**
 * Compact human-friendly summary of the rung that resolved. Used by
 * status UI so a user watching a slow reconnect can see which
 * strategy eventually worked (or whether cache-hit was instant).
 * Compare against `resolveWssCandidates(device)[0]` to detect
 * cache-hit; anything past index 0 is a fallback.
 */
export function classifyRung(
  device: DeviceRecord,
  resolvedUrl: string,
):
  | 'cached'
  | 'tailscale'
  | 'local'
  | 'standard-port'
  | 'ip-fallback'
  | 'unknown' {
  const candidates = resolveWssCandidates(device)
  const idx = candidates.indexOf(resolvedUrl)
  if (idx === -1) return 'unknown'
  if (idx === 0) return 'cached'
  const cachedPort = device.lastPort ?? device.port
  if (
    device.tailscaleHost &&
    resolvedUrl.includes(`${device.tailscaleHost}:`)
  ) {
    return 'tailscale'
  }
  const usesLocal = device.host && resolvedUrl.includes(`${device.host}:`)
  if (usesLocal && resolvedUrl.includes(`:${cachedPort}/`)) return 'local'
  if (usesLocal) return 'standard-port'
  return 'ip-fallback'
}
