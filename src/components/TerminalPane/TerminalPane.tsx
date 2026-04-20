import { Terminal, useTerminal } from '@wterm/react'
import { useCallback, useEffect, useRef } from 'react'
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

export function TerminalPane({ projectId, tabId, cwd }: Props) {
  const { ref, write } = useTerminal()
  const tabKey = makeTabKey(projectId, tabId)

  // Keep write in a ref so the Channel callback captures it by reference
  // rather than closing over a stale value from the first render.
  const writeRef = useRef(write)
  useEffect(() => {
    writeRef.current = write
  }, [write])

  // Called by wterm once the WASM module is loaded and the terminal is ready.
  //
  // Pty lifecycle is owned by the store, not this component:
  //   - openTab is idempotent — returns true if a new pty was spawned,
  //     false if one is already running for this tabKey.
  //   - If a call is already in-flight for this tabKey (StrictMode fires
  //     onReady twice when WASM is cached), skip it.
  //   - If the pty is already running (returning to a tab), send \r to make
  //     the shell re-display the prompt on the fresh terminal.
  //
  // Data arrives via the per-tab Channel passed to openTab — no global event
  // bus listener, no fan-out to other tabs.
  const handleReady = useCallback(() => {
    if (pendingOpens.has(tabKey)) return
    pendingOpens.add(tabKey)

    IPC.openTab(tabKey, cwd, (data) => {
      writeRef.current(data)
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
  }, [tabKey, cwd])

  useEffect(() => {
    const unlistenExit = onPtyExit((id) => {
      if (id === tabKey) writeRef.current('\r\n[Process exited]\r\n')
    })

    return () => {
      unlistenExit.then((fn) => fn())
      // Do NOT close the pty here. Pty lifetime is tied to the tab's
      // existence in the store. removeTab() calls IPC.closeTab() when
      // the user explicitly closes the tab.
    }
  }, [tabKey])

  return (
    <Terminal
      ref={ref}
      autoResize
      wasmUrl="/wterm.wasm"
      className="h-full min-h-0 w-full"
      onReady={handleReady}
      onData={(input) => IPC.writePty(tabKey, input)}
      onResize={(cols, rows) => IPC.resizePty(tabKey, cols, rows)}
    />
  )
}
