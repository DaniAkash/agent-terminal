import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '@nanostores/react'
import { ChevronRight, Folder, Pin } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { hasDangerFlag } from '@/components/agent.helpers'
import { DangerBadge } from '@/components/DangerBadge'
import { RunningDot } from '@/components/RunningDot'
import { SidebarTabItem } from '@/components/Sidebar/SidebarTabItem'
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
  navigateToProject,
  navigateToTab,
} from '@/modules/stores/$navigation'
import {
  $expanded,
  addTab,
  removeProject,
  renameProject,
  reorderTabs,
  toggleExpanded,
  toggleProjectPin,
} from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'
import type { Project } from '@/screens/workspace/workspace.types'

export function SidebarProjectRow({ project }: { project: Project }) {
  const expanded = useStore($expanded)
  const isOpen = !!expanded[project.id]
  const activeProjectId = useStore($activeProjectId)
  const isActive = activeProjectId === project.id
  const allTabMeta = useStore($tabMeta)
  const [renaming, setRenaming] = useState(false)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id })

  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const orderedTabs = [
    ...project.tabs.filter((t) => t.pinned),
    ...project.tabs.filter((t) => !t.pinned),
  ]
  const anyRunning = project.tabs.some(
    (t) => allTabMeta[makeTabKey(project.id, t.id)]?.status === 'running',
  )
  const anyDanger = project.tabs.some((t) => {
    const meta = allTabMeta[makeTabKey(project.id, t.id)]
    return meta?.type === 'agent' && hasDangerFlag(meta.agentCmd)
  })

  function handleTabDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = orderedTabs.findIndex((t) => t.id === active.id)
    const newIdx = orderedTabs.findIndex((t) => t.id === over.id)
    if (orderedTabs[oldIdx]?.pinned !== orderedTabs[newIdx]?.pinned) return
    reorderTabs(project.id, oldIdx, newIdx)
  }

  function handleRename(newName: string) {
    setRenaming(false)
    if (newName) renameProject(project.id, newName)
  }

  function handleAddTab() {
    const tabId = $activeTabId.get()[project.id]
    const cwd = tabId
      ? ($tabMeta.get()[makeTabKey(project.id, tabId)]?.cwd ?? '')
      : ''
    const newTab = addTab(project.id, cwd || undefined)
    if (newTab) {
      navigateToProject(project.id)
      navigateToTab(project.id, newTab.id)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      <ContextMenu>
        <ContextMenuTrigger className="block">
          {/*
           * Row layout: [main button flex-1] [add-tab button?]
           *
           * The "+" new-terminal button is a sibling of the main button, not
           * nested inside it. Nesting buttons is invalid HTML and causes the
           * add-tab action to fire on right-click / middle-click (pointerdown).
           * As a sibling it is keyboard-accessible and only fires on click.
           */}
          <div
            className={cn(
              'mx-1.5 flex h-[26px] w-[calc(100%-12px)] items-center rounded-md',
              isActive
                ? 'bg-sidebar-active text-sidebar-fg-strong'
                : 'text-sidebar-fg hover:bg-sidebar-hover',
            )}
          >
            <button
              type="button"
              className="flex h-full flex-1 cursor-grab select-none items-center gap-1.5 px-1.5 text-left text-[12.5px]"
              onClick={() => {
                if (renaming) return
                toggleExpanded(project.id)
                navigateToProject(project.id)
              }}
              onDoubleClick={() => {
                if (!renaming) setRenaming(true)
              }}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded transition-transform duration-[140ms]',
                  isOpen && 'rotate-90',
                )}
              >
                <ChevronRight
                  size={10}
                  className="shrink-0"
                  style={{ color: 'var(--sidebar-foreground)' }}
                />
              </span>
              <Folder
                size={13}
                className="shrink-0"
                style={{
                  color: isActive
                    ? 'var(--sidebar-foreground-strong)'
                    : 'var(--sidebar-foreground)',
                }}
              />
              {renaming ? (
                <InlineEdit
                  value={project.name}
                  onSave={handleRename}
                  onCancel={() => setRenaming(false)}
                  className="flex-1 bg-transparent text-[12.5px] outline-none"
                />
              ) : (
                <span className="flex-1 truncate font-medium">
                  {project.name}
                </span>
              )}
              {anyRunning && !isOpen && !renaming && <RunningDot />}
              {anyDanger && !isOpen && !renaming && <DangerBadge size={11} />}
              {project.pinned && !renaming && (
                <span
                  title="Unpin project"
                  className="shrink-0 opacity-50 hover:opacity-100"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    toggleProjectPin(project.id)
                  }}
                >
                  <Pin size={9} />
                </span>
              )}
            </button>

            {/* Add-tab — proper sibling button; only fires on primary click */}
            {isOpen && !renaming && (
              <button
                type="button"
                title="New terminal"
                className="ml-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded opacity-50 hover:opacity-100"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  handleAddTab()
                }}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 11 11"
                  role="img"
                  aria-label="New terminal"
                >
                  <path
                    d="M5.5 1.5 V9.5 M1.5 5.5 H9.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44 text-[12px]">
          <ContextMenuItem onClick={() => setRenaming(true)}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={() => toggleProjectPin(project.id)}>
            {project.pinned ? 'Unpin project' : 'Pin project'}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => removeProject(project.id)}
            className="text-destructive"
          >
            Remove project
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <div
        className="overflow-hidden transition-[max-height] duration-[220ms] ease-[cubic-bezier(.4,.1,.2,1)]"
        style={{ maxHeight: isOpen ? orderedTabs.length * 26 + 8 : 0 }}
      >
        <DndContext
          sensors={tabSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleTabDragEnd}
        >
          <SortableContext
            items={orderedTabs.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {orderedTabs.map((t) => (
              <SidebarTabItem key={t.id} tab={t} projectId={project.id} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
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
}: {
  value: string
  onSave: (v: string) => void
  onCancel: () => void
  className?: string
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
    />
  )
}
