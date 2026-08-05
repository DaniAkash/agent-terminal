import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

const URL_KEY = 'agent-terminal.wss.url'
const TOKEN_KEY = 'agent-terminal.wss.token'

export type PairingConfig = {
  url: string | null
  token: string | null
}

export async function loadPairingConfig(): Promise<PairingConfig> {
  const [url, token] = await Promise.all([
    AsyncStorage.getItem(URL_KEY),
    SecureStore.getItemAsync(TOKEN_KEY),
  ])
  return { url, token }
}

export async function savePairingConfig(
  url: string,
  token: string,
): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(URL_KEY, url),
    SecureStore.setItemAsync(TOKEN_KEY, token),
  ])
}
