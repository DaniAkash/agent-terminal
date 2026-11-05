import * as Crypto from 'expo-crypto'
import type { Digest } from './push.sign.helpers'

/**
 * The real digest, bound to expo-crypto.
 *
 * Kept apart from `push.sign.helpers` so bun test can import the pure
 * side without pulling react-native in through expo-crypto, the same
 * split and the same reason as `$devices.helpers.ts`.
 */
export const digest: Digest = (input) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input)

/**
 * Both ends derive the signing key from the pairing token rather than
 * transmitting one: the desktop already stores this exact value as the
 * device's token hash.
 */
export const deriveKey = (deviceToken: string) => digest(deviceToken)
