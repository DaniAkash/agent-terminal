import { Terminal, useTerminal } from '@wterm/react'
import { useCallback, useEffect, useRef } from 'react'
import { IPC } from '@/modules/ipc/commands'
import { onPtyData, onPtyExit } from '@/modules/ipc/events'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'

type Props = {
  projectId: string
  tabId: string
  cwd: string
}

export function TerminalPane({ projectId, tabId, cwd }: Props) {
  const { ref, write } = useTerminal()
  const tabKey = makeTabKey(projectId, tabId)

  // Keep write in a ref so the IPC effect doesn't re-run when the
  // function reference changes between renders, which would register
  // duplicate onPtyData listeners and double every output byte.
  const writeRef = useRef(write)
  useEffect(() => {
    writeRef.current = write
  }, [write])

  // Called by wterm once the WASM module is loaded and the terminal is ready.
  //
  // Pty lifecycle is owned by the store, not this component:
  //   - openTab is idempotent — returns true if a new pty was spawned,
  //     false if one is already running for this tabKey.
  //   - If the pty is already running (returning to a tab, or StrictMode
  //     dev re-mount), the terminal display is fresh but the shell is idle.
  //     Sending \r makes the shell re-display the current prompt line.
  //   - If the pty is new, the shell will send its initial prompt naturally
  //     through the pty:data listener registered in the effect below.
  const handleReady = useCallback(() => {
    IPC.openTab(tabKey, cwd)
      .then((isNew) => {
        if (!isNew) {
          IPC.writePty(tabKey, '\r').catch(() => {})
        }
      })
      .catch(() => {})
  }, [tabKey, cwd])

  useEffect(() => {
    const unlistenData = onPtyData((id, data) => {
      if (id === tabKey) writeRef.current(data)
    })

    const unlistenExit = onPtyExit((id) => {
      if (id === tabKey) writeRef.current('\r\n[Process exited]\r\n')
    })

    return () => {
      unlistenData.then((fn) => fn())
      unlistenExit.then((fn) => fn())
      // Do NOT close the pty here. Pty lifetime is tied to the tab's
      // existence in the store. removeTab() calls IPC.closeTab() when
      // the user explicitly closes the tab.
    }
  }, [tabKey]) // intentionally excludes write — use writeRef instead

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
