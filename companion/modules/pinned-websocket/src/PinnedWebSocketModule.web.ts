import { registerWebModule, NativeModule } from 'expo';

import { PinnedWebSocketModuleEvents } from './PinnedWebSocket.types';

// PinnedWebSocketModule is not available on the web platform.
class PinnedWebSocketModule extends NativeModule<PinnedWebSocketModuleEvents> {}

export default registerWebModule(PinnedWebSocketModule, 'PinnedWebSocketModule');
