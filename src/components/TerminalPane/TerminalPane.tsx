import { Terminal, useTerminal } from '@wterm/react'
import { useEffect } from 'react'
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

  useEffect(() => {
    IPC.openTab(tabKey, cwd).catch(() => {})

    const unlistenData = onPtyData((id, data) => {
      if (id === tabKey) write(data)
    })

    const unlistenExit = onPtyExit((id) => {
      if (id === tabKey)
        write(new TextEncoder().encode('\r\n[Process exited]\r\n'))
    })

    return () => {
      unlistenData.then((fn) => fn())
      unlistenExit.then((fn) => fn())
      IPC.closeTab(tabKey).catch(() => {})
    }
  }, [tabKey, cwd, write])

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
