import { Terminal, useTerminal } from '@wterm/react'
import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    IPC.openTab(tabKey, cwd).catch(() => {})

    const unlistenData = onPtyData((id, data) => {
      if (id === tabKey) writeRef.current(data)
    })

    const unlistenExit = onPtyExit((id) => {
      if (id === tabKey)
        writeRef.current(new TextEncoder().encode('\r\n[Process exited]\r\n'))
    })

    return () => {
      unlistenData.then((fn) => fn())
      unlistenExit.then((fn) => fn())
      IPC.closeTab(tabKey).catch(() => {})
    }
  }, [tabKey, cwd]) // intentionally excludes write — use writeRef instead

  return (
    <Terminal
      ref={ref}
      autoResize
      className="h-full min-h-0 w-full"
      onData={(input) =>
        IPC.writePty(tabKey, Array.from(new TextEncoder().encode(input)))
      }
      onResize={(cols, rows) => IPC.resizePty(tabKey, cols, rows)}
    />
  )
}
