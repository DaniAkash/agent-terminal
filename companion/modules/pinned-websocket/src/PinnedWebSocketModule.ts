import { NativeModule, requireNativeModule } from 'expo';

import { PinnedWebSocketModuleEvents } from './PinnedWebSocket.types';

declare class PinnedWebSocketModule extends NativeModule<PinnedWebSocketModuleEvents> {
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

export default requireNativeModule<PinnedWebSocketModule>('PinnedWebSocket');
