import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Keys } from '@/modules/keymap/keys'
import {
  $activeSearch,
  closeSearch,
  setSearchQuery,
} from '@/modules/stores/$activeSearch'
import { $activeTerminalHandle } from '@/modules/stores/$activeTerminal'

/**
 * Floating overlay that opens via Cmd+F over the active terminal. Drives
 * `@xterm/addon-search` through the active-terminal handle registry. Esc
 * (or the close button) returns focus to xterm.
 */
export function TerminalSearchBar() {
  const search = useStore($activeSearch)
  const inputRef = useRef<HTMLInputElement>(null)
  // Re-focus only when the bar opens or the active tab changes — depending
  // on `search` directly would yank focus on every keystroke as the user
  // types into the input.
  const tabKey = search?.tabKey
  useEffect(() => {
    if (tabKey) inputRef.current?.focus()
  }, [tabKey])

  useHotkeys(
    Keys.Escape,
    () => {
      if (!search) return
      closeSearch()
      $activeTerminalHandle.get()?.focus()
    },
    { enableOnFormTags: true, enabled: !!search },
  )

  if (!search) return null

  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border border-border bg-popover px-2 py-1 shadow-md">
      <input
        ref={inputRef}
        value={search.query}
        onChange={(e) => {
          setSearchQuery(e.target.value)
          // Live-search: incremental:true makes the addon expand the
          // existing selection while the growing query still matches it,
          // so the highlight stays anchored to the current match instead
          // of bouncing forward through the buffer on every keystroke.
          $activeTerminalHandle.get()?.searchNext({ incremental: true })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) $activeTerminalHandle.get()?.searchPrevious()
            else $activeTerminalHandle.get()?.searchNext()
          }
        }}
        className="w-48 bg-transparent text-sm outline-none"
        placeholder="Find"
      />
      <button
        type="button"
        onClick={() => $activeTerminalHandle.get()?.searchPrevious()}
        className="rounded px-1 text-xs hover:bg-accent"
        title="Previous (⇧⏎)"
        aria-label="Previous match"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => $activeTerminalHandle.get()?.searchNext()}
        className="rounded px-1 text-xs hover:bg-accent"
        title="Next (⏎)"
        aria-label="Next match"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={() => {
          closeSearch()
          $activeTerminalHandle.get()?.focus()
        }}
        className="rounded px-1 text-xs hover:bg-accent"
        title="Close (Esc)"
        aria-label="Close find"
      >
        ✕
      </button>
    </div>
  )
}
