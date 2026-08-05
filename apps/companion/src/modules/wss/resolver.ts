import type { DeviceRecord } from '@/modules/stores/$device'

/**
 * Self-healing WSS resolver ladder. Given a DeviceRecord (from
 * `$device`), returns the sequence of `wss://` URLs the client
 * should try, in order, when opening a connection. First success
 * wins; `client.ts` iterates through them until one auth-completes
 * or all fail.
 *
 * The ladder rungs:
 *
 * 1. **Cached IP + cached port** — steady-state fast path.
 * 2. **`.local` + cached port** — handles a same-LAN IP change
 *    (DHCP renewal, network switch). System resolver on both iOS
 *    and Android handles mDNS `.local` transparently, so no
 *    dev-client zeroconf plugin is required.
 * 3. **`.local` + each of the three standard ports** — handles a
 *    desktop reboot that landed on a different port from the trio.
 *    Skips the port already tried at rung 2 so we don't burn a
 *    duplicate attempt.
 * 4. **QR-known IPs + each standard port** — belt-and-suspenders
 *    for the case where the phone's mDNS resolution is broken
 *    (some carriers block .local, some corporate WiFi disables
 *    mDNS entirely). Falls back to whatever IPs the QR carried.
 *
 * Callers apply a 2s per-attempt timeout so the whole ladder
 * finishes in ~10s worst case even when everything fails.
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
  const push = (host: string, port: number) => {
    if (!host) return
    const url = `wss://${host}:${port}/stream`
    if (seen.has(url)) return
    seen.add(url)
    candidates.push(url)
  }

  const cachedPort = device.lastPort ?? device.port
  const cachedIp = device.lastIp ?? device.ips[0]

  // Rung 1: cached IP + cached port.
  if (cachedIp) push(cachedIp, cachedPort)

  // Rung 2: .local + cached port.
  if (device.host) push(device.host, cachedPort)

  // Rung 3: .local + each standard port (excluding cachedPort).
  if (device.host) {
    for (const p of STANDARD_PORTS) {
      if (p === cachedPort) continue
      push(device.host, p)
    }
  }

  // Rung 4: QR-known IPs + each standard port.
  for (const ip of device.ips) {
    for (const p of STANDARD_PORTS) {
      push(ip, p)
    }
  }

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
): 'cached' | 'local' | 'standard-port' | 'ip-fallback' | 'unknown' {
  const candidates = resolveWssCandidates(device)
  const idx = candidates.indexOf(resolvedUrl)
  if (idx === -1) return 'unknown'
  if (idx === 0) return 'cached'
  const cachedPort = device.lastPort ?? device.port
  const usesLocal = device.host && resolvedUrl.includes(`${device.host}:`)
  if (usesLocal && resolvedUrl.includes(`:${cachedPort}/`)) return 'local'
  if (usesLocal) return 'standard-port'
  return 'ip-fallback'
}
