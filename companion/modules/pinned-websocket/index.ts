// Re-export the native module. On web, it will be resolved to PinnedWebSocketModule.web.ts
// and on native platforms to PinnedWebSocketModule.ts
export { default } from './src/PinnedWebSocketModule';
export * from './src/PinnedWebSocket.types';
