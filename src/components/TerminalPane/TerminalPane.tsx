import React, { useCallback, useEffect, useRef } from 'react'
import {
  GhosttyTerminal,
  type GhosttyTerminalHandle,
} from '@/components/GhosttyTerminal/GhosttyTerminal'
import { IPC } from '@/modules/ipc/commands'
import { onPtyExit } from '@/modules/ipc/events'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'

// Tracks in-flight openTab calls per tabKey. Prevents concurrent calls
// (e.g. React StrictMode firing onReady twice when WASM is cached) from
// spawning two ptys and showing a double prompt.
const pendingOpens = new Set<string>()

type Props = {
  projectId: string
  tabId: string
  cwd: string
}

export const TerminalPane = React.memo(function TerminalPane({
  projectId,
  tabId,
  cwd,
}: Props) {
  const tabKey = makeTabKey(projectId, tabId)
  const handleRef = useRef<GhosttyTerminalHandle | null>(null)

  // Called once when ghostty-web WASM finishes loading and the canvas is ready.
  //
  // Pty lifecycle is owned by the store, not this component:
  //   - openTab is idempotent — returns true if a new pty was spawned,
  //     false if one is already running for this tabKey.
  //   - If a call is already in-flight for this tabKey (StrictMode fires
  //     onReady twice when WASM is cached), skip it.
  //   - If the pty is already running (reconnect path), send \r to make
  //     the shell re-display the prompt.
  //
  // Data arrives via the per-tab Channel passed to openTab — no global event
  // bus listener, no fan-out to other tabs.
  const handleReady = useCallback(
    (handle: GhosttyTerminalHandle) => {
      handleRef.current = handle

      if (pendingOpens.has(tabKey)) return
      pendingOpens.add(tabKey)

      IPC.openTab(tabKey, cwd, (data) => {
        handleRef.current?.write(data)
      })
        .then((isNew) => {
          pendingOpens.delete(tabKey)
          if (!isNew) {
            IPC.writePty(tabKey, '\r').catch(() => {})
          }
        })
        .catch(() => {
          pendingOpens.delete(tabKey)
        })
    },
    [tabKey, cwd],
  )

  const handleData = useCallback(
    (input: string) => {
      IPC.writePty(tabKey, input).catch(() => {})
    },
    [tabKey],
  )

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      IPC.resizePty(tabKey, cols, rows).catch(() => {})
    },
    [tabKey],
  )

  useEffect(() => {
    const unlistenExit = onPtyExit((id) => {
      if (id === tabKey) handleRef.current?.write('\r\n[Process exited]\r\n')
    })

    return () => {
      unlistenExit.then((fn) => fn())
      // Do NOT close the pty here. Pty lifetime is tied to the tab's
      // existence in the store. removeTab() calls IPC.closeTab() when
      // the user explicitly closes the tab.
    }
  }, [tabKey])

  return (
    <GhosttyTerminal
      onReady={handleReady}
      onData={handleData}
      onResize={handleResize}
      className="h-full min-h-0 w-full"
    />
  )
})
