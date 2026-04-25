import React, { useCallback, useEffect, useRef } from 'react'
import {
  type XTermHandle,
  XTermTerminal,
} from '@/components/XTermTerminal/XTermTerminal'
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
  /** True when this tab is the currently visible one. Used to auto-focus
   *  the xterm canvas so the user can type immediately after switching tabs
   *  or projects without needing to click into the terminal first. */
  isActive: boolean
}

export const TerminalPane = React.memo(function TerminalPane({
  projectId,
  tabId,
  cwd,
  isActive,
}: Props) {
  const tabKey = makeTabKey(projectId, tabId)
  const handleRef = useRef<XTermHandle | null>(null)

  // Auto-focus the xterm canvas when this tab becomes active.
  //
  // The effect runs after React has painted, which means WorkspaceView has
  // already applied `display: block` to the container div. Calling focus()
  // on a display:none element is a no-op in xterm, so the paint-after timing
  // here is load-bearing — do not call focus() synchronously on prop change.
  useEffect(() => {
    if (isActive) {
      handleRef.current?.focus()
    }
  }, [isActive])

  // Called once when the xterm canvas is ready.
  //
  // Pty lifecycle is owned by the store, not this component:
  //   - openTab is idempotent — returns true if a new pty was spawned,
  //     false if one is already running for this tabKey.
  //   - If a call is already in-flight for this tabKey (StrictMode fires
  //     onReady twice on dev), skip it.
  //   - If the pty is already running (reconnect path), send \r to make
  //     the shell re-display the prompt.
  //
  // Data arrives via the per-tab Channel passed to openTab — no global event
  // bus listener, no fan-out to other tabs.
  const handleReady = useCallback(
    (handle: XTermHandle) => {
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
    <XTermTerminal
      onReady={handleReady}
      onData={handleData}
      onResize={handleResize}
      className="h-full min-h-0 w-full"
    />
  )
})
