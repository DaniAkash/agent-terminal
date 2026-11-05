import * as Crypto from 'expo-crypto'
import type { Digest } from './push.sign.helpers'
import { signWith } from './push.sign.helpers'

/** The real digest. Kept apart from the helpers so bun test can import
 *  them without pulling react-native in through expo-crypto. */
export const digest: Digest = (input) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input)

export const sign = (keyHex: string, msg: string) =>
  signWith(digest, keyHex, msg)

/** Both ends derive the signing key from the pairing token rather than
 *  transmitting one: the desktop already stores this exact value. */
export const deriveKey = (deviceToken: string) => digest(deviceToken)

export { canonical, timingSafeEqual } from './push.sign.helpers'
