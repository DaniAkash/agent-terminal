/**
 * Payload MAC, with the digest injected.
 *
 * Pure and import-free on purpose. `expo-crypto` pulls react-native
 * into the module graph, which bun test cannot parse, so the digest
 * arrives as an argument and `push.sign.ts` binds the real one. Same
 * split, and the same reason, as `$devices.helpers.ts`.
 *
 * ## Why a MAC at all
 *
 * Expo requires no access token to send by default, so anyone holding
 * this device's Expo push token could otherwise make arbitrary text
 * appear under the app's name: a phishing surface pointed at someone
 * used to approving things. The key needs no transmission, because the
 * desktop already stores SHA-256 of the device token for auth and this
 * end holds the raw token in SecureStore.
 *
 * Nested rather than a single keyed digest, because SHA-256 is
 * length-extendable. Not real HMAC because `expo-crypto` exposes
 * digests and no keyed-hash function, which is also why every step is
 * string in, hex string out.
 */

export type Digest = (input: string) => Promise<string>

const SIG_HEX_LEN = 32

/**
 * The exact bytes the signature covers. Field order is part of the
 * format: the Rust side pins this same string in a test, and the two
 * must agree byte for byte because `data` is free-form JSON that the
 * typeshare drift check cannot see.
 */
export function canonical(input: {
  v: number
  deviceId: string
  projectId: string
  tabId: string
  state: string
  firedAt: number
}): string {
  return `v${input.v}|${input.deviceId}|${input.projectId}|${input.tabId}|${input.state}|${input.firedAt}`
}

/** `keyHex` is SHA-256 of this device's pairing token, lowercase hex. */
export async function signWith(
  digest: Digest,
  keyHex: string,
  msg: string,
): Promise<string> {
  const inner = await digest(`${keyHex}|${msg}`)
  const outer = await digest(`${keyHex}|${inner}`)
  return outer.slice(0, SIG_HEX_LEN)
}

/**
 * Length-independent, value-independent compare. A `===` here would
 * leak the expected signature one byte at a time to anyone who can
 * time the app's response to a push.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}
