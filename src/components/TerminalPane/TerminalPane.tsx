import { Terminal, useTerminal } from '@wterm/react'
import { useCallback, useEffect, useRef } from 'react'
import { IPC } from '@/modules/ipc/commands'
import { onPtyData, onPtyExit } from '@/modules/ipc/events'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'

// Module-level map so it survives React StrictMode's unmount→remount cycle.
// When cleanup schedules a close, we store the timer here. If onReady fires
// again for the same key before the timer fires, we cancel the close and
// skip re-opening the pty (it's still alive).
const pendingCloses = new Map<string, ReturnType<typeof setTimeout>>()

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

  // Called by wterm once the WASM module is loaded and the terminal is ready
  // to accept data. Opening the pty here ensures no output is lost before
  // the terminal can display it.
  const handleReady = useCallback(() => {
    const pending = pendingCloses.get(tabKey)
    if (pending) {
      // StrictMode remount: the pty is still alive — just cancel the
      // scheduled close and skip re-opening.
      clearTimeout(pending)
      pendingCloses.delete(tabKey)
      return
    }
    IPC.openTab(tabKey, cwd).catch(() => {})
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
      // Delay the actual pty close by 50ms. StrictMode's cleanup+remount
      // happens synchronously, so handleReady will fire and cancel this
      // timer before it ever runs. A real navigation unmount waits far
      // longer than 50ms, so the close still happens correctly.
      const timer = setTimeout(() => {
        pendingCloses.delete(tabKey)
        IPC.closeTab(tabKey).catch(() => {})
      }, 50)
      pendingCloses.set(tabKey, timer)
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
