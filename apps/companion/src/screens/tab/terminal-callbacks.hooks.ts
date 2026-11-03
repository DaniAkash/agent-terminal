import { type RefObject, useEffect, useRef } from 'react'

export interface TerminalCallbacks {
  onData: (data: string) => Promise<void>
  onResize: (cols: number, rows: number) => Promise<void>
  onReady: () => Promise<void>
  /** Hand a validated link to the OS, since the WebView cannot open one. */
  onOpenUrl: (url: string) => Promise<void>
}

type CallbackRefs = {
  [K in keyof TerminalCallbacks]: RefObject<TerminalCallbacks[K]>
}

/**
 * Hold the latest terminal callbacks behind refs.
 *
 * Both platform components mount their terminal once and read the
 * callbacks from events that fire later, so taking the props directly
 * would put them in the setup effect's deps and remount the terminal
 * every time a parent state change gave them new identities. The
 * modifier toggles in `ExtraKeysBar` do exactly that.
 *
 * The sync runs in an effect with no deps, after every commit, rather
 * than as a render-time mutation, which keeps it correct if React
 * replays a render. The resulting one-cycle lag is invisible because
 * nothing reads these before commit.
 */
export function useTerminalCallbackRefs(
  callbacks: TerminalCallbacks,
): CallbackRefs {
  const onData = useRef(callbacks.onData)
  const onResize = useRef(callbacks.onResize)
  const onReady = useRef(callbacks.onReady)
  const onOpenUrl = useRef(callbacks.onOpenUrl)
  useEffect(() => {
    onData.current = callbacks.onData
    onResize.current = callbacks.onResize
    onReady.current = callbacks.onReady
    onOpenUrl.current = callbacks.onOpenUrl
  })
  return { onData, onResize, onReady, onOpenUrl }
}
