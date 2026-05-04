import { useStore } from '@nanostores/react'
import React, { useCallback, useEffect, useRef } from 'react'
import {
  type XTermHandle,
  XTermTerminal,
} from '@/components/XTermTerminal/XTermTerminal'
import { IPC } from '@/modules/ipc/commands'
import { onPtyExit, onPtyRespawned } from '@/modules/ipc/events'
import { $activeTerminalHandle } from '@/modules/stores/$activeTerminal'
import { $tabMeta } from '@/modules/stores/$tabMeta'
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
  // Reactive read — flips on the next render whenever ClaudeCodeMod /
  // CodexMod sets or clears `type === 'agent'` for this tab. xterm's
  // key handler reads it (via ref) on the next keypress.
  const allTabMeta = useStore($tabMeta)
  const isAgent = allTabMeta[tabKey]?.type === 'agent'

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

  // Register this terminal as the active one whenever its tab is visible.
  // Global hotkeys (Cmd+K, Cmd+A, Cmd+F, Cmd+G) read from the registry to
  // dispatch terminal-scoped actions. Race-safe clear: only nil out the
  // slot if it still points at us.
  //
  // The matching set call inside `handleReady` (below) covers the case
  // where the pane mounts already-active and the handle isn't ready yet
  // when this effect first runs. Without that, first-launch left the
  // registry stuck at null until the user switched tabs.
  useEffect(() => {
    if (!isActive) return
    if (handleRef.current) {
      $activeTerminalHandle.set(handleRef.current)
    }
    return () => {
      if ($activeTerminalHandle.get() === handleRef.current) {
        $activeTerminalHandle.set(null)
      }
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
      // If this pane mounted already-active, the registration effect above
      // ran before the handle existed. Catch up now so global hotkeys
      // work on first launch without requiring a tab switch.
      if (isActive) {
        $activeTerminalHandle.set(handle)
      }

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
    [tabKey, cwd, isActive],
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
    // pty:exit only fires when the user closed the tab — the backend now
    // respawns automatically when the shell self-exits (typed `exit`,
    // segfault, etc.) and emits pty:respawned instead. So this banner
    // shouldn't actually show up in normal use; kept as a safety net for
    // the rate-limit fallback path.
    const unlistenExit = onPtyExit((id) => {
      if (id === tabKey) handleRef.current?.write('\r\n[Process exited]\r\n')
    })

    const unlistenRespawn = onPtyRespawned((id, cwd) => {
      if (id !== tabKey) return
      // Strip Unicode control characters (Cc category — covers C0/C1) from
      // the path before injecting it into the xterm stream. cwd ultimately
      // comes from a shell-emitted OSC 7 + URL decode, which can produce
      // literal control bytes if a directory name contains `%1B` or
      // similar — without this scrub, opening such a folder would inject
      // arbitrary terminal escapes through the restart banner.
      const safe = cwd?.replace(/\p{Cc}/gu, '?') ?? ''
      const where = safe ? ` in ${safe}` : ''
      // Dim ANSI so the banner reads as system chrome, not shell output.
      handleRef.current?.write(
        `\r\n\x1b[2m[Shell restarted${where}]\x1b[0m\r\n`,
      )
    })

    return () => {
      unlistenExit.then((fn) => fn())
      unlistenRespawn.then((fn) => fn())
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
      isAgent={isAgent}
      className="h-full min-h-0 w-full"
    />
  )
})
