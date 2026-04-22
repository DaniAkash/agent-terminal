import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '@nanostores/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Pin } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { hasDangerFlag } from '@/components/agent.helpers'
import { DangerBadge } from '@/components/DangerBadge'
import { TabStatusIcon } from '@/components/TabStatusIcon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import {
  $activeProjectId,
  $activeTabId,
  navigateToTab,
  onTabRemoved,
} from '@/modules/stores/$navigation'
import { removeTab, renameTab, toggleTabPin } from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import {
  MONO_FONT,
  makeTabKey,
  resolveTabLabel,
} from '@/screens/workspace/workspace.helpers'
import type { Tab } from '@/screens/workspace/workspace.types'

export function SidebarTabItem({
  tab,
  projectId,
}: {
  tab: Tab
  projectId: string
}) {
  const activeProjectId = useStore($activeProjectId)
  const activeTabsByProject = useStore($activeTabId)
  const allTabMeta = useStore($tabMeta)
  const isActive =
    activeProjectId === projectId && activeTabsByProject[projectId] === tab.id
  const tabMeta = allTabMeta[makeTabKey(projectId, tab.id)]
  const prUrl = tabMeta?.git?.pr?.url
  const [renaming, setRenaming] = useState(false)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id })

  // Strip role so Biome doesn't see a static role="button" on a div
  const { role: _role, ...safeAttributes } = attributes

  function handleRename(newLabel: string) {
    setRenaming(false)
    if (newLabel) renameTab(projectId, tab.id, newLabel)
  }

  function handleClose() {
    onTabRemoved(projectId, tab.id)
    removeTab(projectId, tab.id)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
        <div
          ref={setNodeRef}
          style={{
            transform: CSS.Transform.toString(transform),
            transition,
            opacity: isDragging ? 0.5 : 1,
          }}
          {...safeAttributes}
          {...listeners}
        >
          <button
            type="button"
            className={cn(
              'relative mx-1.5 flex h-[26px] w-[calc(100%-12px)] items-center gap-2 rounded-md pr-2 pl-[20px] text-left',
              isActive
                ? 'bg-sidebar-active text-sidebar-fg-strong'
                : 'text-sidebar-fg hover:bg-sidebar-hover',
            )}
            onClick={() => navigateToTab(projectId, tab.id)}
            onDoubleClick={() => {
              if (!renaming) setRenaming(true)
            }}
          >
            {isActive && (
              <span className="absolute top-1.5 bottom-1.5 left-3.5 w-0.5 rounded-sm bg-accent" />
            )}

            {/*
             * Left pin slot — fixed width so label text stays aligned across
             * all rows regardless of pinned state. Only shows the icon when
             * pinned; stays invisible otherwise. Hidden during inline rename
             * so the input gets the full width.
             */}
            {!renaming && (
              <span className="w-4 shrink-0 flex items-center justify-center">
                {tab.pinned && (
                  <span
                    title="Unpin tab"
                    className="opacity-50 hover:opacity-100"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      toggleTabPin(projectId, tab.id)
                    }}
                  >
                    <Pin size={9} />
                  </span>
                )}
              </span>
            )}

            {/* Label / rename input */}
            {renaming ? (
              <InlineEdit
                value={tab.label}
                onSave={handleRename}
                onCancel={() => setRenaming(false)}
                className="flex-1 bg-transparent outline-none"
                style={{ fontFamily: MONO_FONT, fontSize: 11.5 }}
              />
            ) : (
              <span
                className={cn('flex-1 truncate', isActive && 'font-medium')}
                style={{ fontFamily: MONO_FONT, fontSize: 11.5 }}
              >
                {resolveTabLabel(tab, tabMeta?.cwd)}
              </span>
            )}

            {/*
             * Right-side indicators, left to right:
             *   PR link → DangerBadge → StatusIcon
             *
             * DangerBadge sits immediately left of the status icon so it reads
             * as "this agent is running hot" rather than a separate entity.
             * PR link comes before danger so it groups with the label content.
             */}
            {!renaming && tabMeta?.git?.pr && prUrl && (
              <a
                href={prUrl}
                className="shrink-0 rounded px-1 text-[9.5px] text-accent opacity-70 hover:opacity-100"
                style={{ fontFamily: MONO_FONT }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  openUrl(prUrl).catch(() => {})
                }}
              >
                #{tabMeta.git.pr.number}
              </a>
            )}
            {!renaming && tabMeta?.type === 'agent' && hasDangerFlag(tabMeta.agentCmd) && (
              <DangerBadge size={11} />
            )}
            {!renaming && (
              <TabStatusIcon tabId={makeTabKey(projectId, tab.id)} active={isActive} />
            )}
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 text-[12px]">
        <ContextMenuItem onClick={() => setRenaming(true)}>
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => toggleTabPin(projectId, tab.id)}>
          {tab.pinned ? 'Unpin tab' : 'Pin tab'}
        </ContextMenuItem>
        {!tab.pinned && (
          <ContextMenuItem onClick={handleClose} className="text-destructive">
            Close tab
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/* ---------------------------------------------------------------------------
 * InlineEdit — borderless input that replaces a label on double-click
 * -------------------------------------------------------------------------*/

function InlineEdit({
  value,
  onSave,
  onCancel,
  className,
  style,
}: {
  value: string
  onSave: (v: string) => void
  onCancel: () => void
  className?: string
  style?: React.CSSProperties
}) {
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          const trimmed = draft.trim()
          trimmed ? onSave(trimmed) : onCancel()
        }
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => {
        const trimmed = draft.trim()
        trimmed ? onSave(trimmed) : onCancel()
      }}
      onClick={(e) => e.stopPropagation()}
      className={className}
      style={style}
    />
  )
}
