import { listen } from '@tauri-apps/api/event'

export const onPtyData = (cb: (tabId: string, data: string) => void) =>
  listen<{ tabId: string; data: string }>('pty:data', (e) =>
    cb(e.payload.tabId, e.payload.data),
  )

export const onPtyExit = (cb: (tabId: string) => void) =>
  listen<{ tabId: string }>('pty:exit', (e) => cb(e.payload.tabId))
