import { NativeModule, requireNativeModule } from 'expo'

import type { PinnedWebSocketModuleEvents } from './PinnedWebSocket.types'

declare class PinnedWebSocketModule extends NativeModule<PinnedWebSocketModuleEvents> {
  connect(url: string, fingerprint: string): Promise<string>
  send(id: string, text: string): void
  close(id: string, code?: number, reason?: string): Promise<void>
}

export default requireNativeModule<PinnedWebSocketModule>('PinnedWebSocket')
