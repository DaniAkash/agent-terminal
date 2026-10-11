import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

const URL_KEY = 'agent-terminal.wss.url'
const TOKEN_KEY = 'agent-terminal.wss.token'
const FINGERPRINT_KEY = 'agent-terminal.wss.fingerprint'

export type PairingConfig = {
  url: string | null
  token: string | null
  fingerprint: string | null
}

export async function loadPairingConfig(): Promise<PairingConfig> {
  const [url, token, fingerprint] = await Promise.all([
    AsyncStorage.getItem(URL_KEY),
    SecureStore.getItemAsync(TOKEN_KEY),
    AsyncStorage.getItem(FINGERPRINT_KEY),
  ])
  return { url, token, fingerprint }
}

export async function savePairingConfig(
  url: string,
  token: string,
  fingerprint: string,
): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(URL_KEY, url),
    SecureStore.setItemAsync(TOKEN_KEY, token),
    AsyncStorage.setItem(FINGERPRINT_KEY, fingerprint),
  ])
}
