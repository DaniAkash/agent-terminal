import { listen } from '@tauri-apps/api/event'

export const onPtyData = (cb: (tabId: string, data: Uint8Array) => void) =>
  listen<{ tabId: string; data: number[] }>('pty:data', (e) =>
    cb(e.payload.tabId, new Uint8Array(e.payload.data)),
  )

export const onPtyExit = (cb: (tabId: string) => void) =>
  listen<{ tabId: string }>('pty:exit', (e) => cb(e.payload.tabId))
