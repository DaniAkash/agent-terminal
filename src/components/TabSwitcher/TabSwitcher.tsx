import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { TabStatusIcon } from '@/components/TabStatusIcon'
import {
  buildSwitcherRows,
  filterSwitcherRows,
  formatRelativeTime,
  type SwitcherRow,
} from '@/components/TabSwitcher/tab-switcher.helpers'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { Keys, Mod } from '@/modules/keymap/keys'
import {
  $activeProjectId,
  $activeTabId,
  navigateToTab,
} from '@/modules/stores/$navigation'
import { $projects } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { $tabRecency, $tabRecencyTimes } from '@/modules/stores/$tabRecency'
import { MONO_FONT } from '@/screens/workspace/workspace.helpers'

/* ---------------------------------------------------------------------------
 * TabSwitcher — Cmd+P quick-switch palette.
 *
 * Lists every open tab sorted by recency. Filterable by typing into the
 * search input — case-insensitive substring match across label + project
 * name + cwd (filterSwitcherRows). Substring rather than fuzzy on purpose
 * so the recency order is preserved among matches; a fuzzy scorer would
 * re-rank by score and break that.
 *
 * Enter switches to the selected tab. Rank shown for every visited tab —
 * no cap, unlike the sidebar's 1..10 ambient badge.
 * -------------------------------------------------------------------------*/

// Owns its own open state and Cmd+P hotkey so consumers (WorkspaceLayout)
// can just render `<TabSwitcher />`. Keeps `WorkspaceLayout` short and
// makes future call sites trivial.
const hotkeyOpts = { preventDefault: true, enableOnFormTags: true } as const

export function TabSwitcher() {
  const [open, setOpen] = useState(false)

  // ⌘P — toggle. Matches VS Code / Cursor / Sublime quick-switcher.
  // preventDefault suppresses the webview's default print dialog.
  useHotkeys(`${Mod.Meta}+${Keys.P}`, () => setOpen((v) => !v), hotkeyOpts)

  const projects = useStore($projects)
  const recency = useStore($tabRecency)
  const recencyTimes = useStore($tabRecencyTimes)
  const tabMeta = useStore($tabMeta)
  const activeProjectId = useStore($activeProjectId)
  const activeTabIds = useStore($activeTabId)
  const [query, setQuery] = useState('')

  // Re-render every 30s while open so "3m ago" stays fresh without
  // invalidating sidebar subscribers.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [open])

  // Reset query each time the dialog opens. Otherwise a previous search
  // lingers and the user sees a filtered list when they expected the full
  // recency view.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const rows = useMemo(
    () =>
      buildSwitcherRows({
        projects,
        recency,
        recencyTimes,
        tabMeta,
        activeProjectId,
        activeTabIds,
      }),
    [projects, recency, recencyTimes, tabMeta, activeProjectId, activeTabIds],
  )

  const filtered = useMemo(() => filterSwitcherRows(rows, query), [rows, query])

  function handleSelect(row: SwitcherRow): void {
    setOpen(false)
    if (!row.isCurrent) navigateToTab(row.projectId, row.tabId)
  }

  // Recompute `now` on each render (including the 30s tick) so the
  // relative-time formatter stays fresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick forces refresh
  const now = useMemo(() => Date.now(), [tick, open])

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Tab switcher"
      description="Jump to a recently active tab"
      // VS Code-style placement: pinned near the top of the terminal area
      // (not the whole window — sidebar shifts the centre right by
      // --sidebar-half). top:64px puts it just below the TabBar.
      className="top-16 left-[calc(50%+var(--sidebar-half))] sm:max-w-[600px]"
    >
      {/* shouldFilter=false: we own the filter (filterSwitcherRows) so we
          can preserve recency order among matches. cmdk's default filter
          would score-sort and lose the recency ranking. */}
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search tabs…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-[380px] p-1.5">
          <CommandEmpty className="py-8 text-sm opacity-60">
            No matching tabs.
          </CommandEmpty>
          {filtered.map((row, idx) => (
            <CommandItem
              key={row.tabKey}
              // cmdk derives data-selected from a strict value-string match
              // (state.value === item.value), so any two items sharing the
              // same value collapse into one selection slot — Enter always
              // fires the first match because cmdk's lookup uses
              // querySelector('[data-selected=true]'). Prefix with the row
              // index so the value is guaranteed unique even if a future
              // change ever lets tabKey collide. onSelect uses a closure
              // over `row` so the value itself is never dispatched.
              value={`${idx}|${row.tabKey}`}
              onSelect={() => handleSelect(row)}
              className={cn(
                // Layout: comfortably padded row, fixed-rhythm gap.
                'group/row relative my-0.5 flex items-center gap-3 px-3 py-2.5',
                // Visible selected/hover state (cmdk sets data-selected
                // on both keyboard nav and mouseover) — accent-soft is the
                // colored 10-14% wash that pairs with the accent rail.
                'data-[selected=true]:bg-[var(--accent-soft)]',
                'data-[selected=true]:text-foreground',
                // Left accent bar — invisible by default, accent when selected.
                "before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-r before:bg-transparent before:content-['']",
                'data-[selected=true]:before:bg-accent',
                'before:transition-colors',
                row.isCurrent && 'opacity-55',
              )}
            >
              {/* Rank — fixed-width column so digits line up across rows. */}
              <span
                aria-hidden="true"
                className="w-5 shrink-0 text-right tabular-nums opacity-45 group-data-[selected=true]/row:opacity-80"
                style={{ fontFamily: MONO_FONT, fontSize: 10.5 }}
              >
                {row.rank > 0 ? row.rank : ''}
              </span>

              {/* Status icon slot — fixed 16px square. AgentGlyph (14px)
                  centres inside; dot icons sit centred too. Keeps the
                  label column origin stable across icon types. */}
              <div className="flex size-4 shrink-0 items-center justify-center">
                <TabStatusIcon tabId={row.tabKey} active={row.isCurrent} />
              </div>

              {/* Label + meta — two lines, comfortable leading. */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 text-[13px] leading-snug">
                  <span className="truncate">{row.label}</span>
                  {row.isCurrent && (
                    <span className="shrink-0 text-[10.5px] opacity-50">
                      (current)
                    </span>
                  )}
                </div>
                <div
                  className="mt-1 truncate text-[11px] leading-snug opacity-55"
                  style={{ fontFamily: MONO_FONT }}
                >
                  <span className="opacity-90">{row.projectName}</span>
                  {row.cwd && (
                    <>
                      <span className="opacity-50"> · </span>
                      {/* Full cwd path here (not the basename) — the
                          label already shows the basename for un-renamed
                          tabs, so basename in meta would just repeat it.
                          Full path adds context (which subfolder of which
                          project). truncate handles overflow. */}
                      {row.cwd}
                    </>
                  )}
                  <span className="opacity-50"> · </span>
                  {formatRelativeTime(now, row.lastActiveAt)}
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
