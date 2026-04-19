import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Pin, X } from 'lucide-react'
import { RunningDot } from '@/components/RunningDot'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import {
  addTab,
  removeTab,
  reorderTabs,
  toggleTabPin,
} from '@/modules/stores/$projects'
import { MONO_FONT } from '@/screens/workspace/workspace.helpers'
import type { Project, Tab } from '@/screens/workspace/workspace.types'

/* ---------------------------------------------------------------------------
 * TabItem — single sortable tab pill
 * -------------------------------------------------------------------------*/
function TabItem({ tab, projectId }: { tab: Tab; projectId: string }) {
  const navigate = useNavigate()
  const { tabId: activeTab } = useParams({ strict: false })
  const isActive = activeTab === tab.id

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id, disabled: tab.pinned })

  // Destructure role out so Biome doesn't see a static role="button" on a div,
  // but keep the rest of the a11y attributes (aria-describedby, tabIndex, etc.)
  const { role: _role, ...safeAttributes } = attributes

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
        <div
          ref={setNodeRef}
          style={{
            transform: CSS.Transform.toString(transform),
            transition,
            opacity: isDragging ? 0.5 : 1,
            zIndex: isDragging ? 50 : undefined,
          }}
          {...safeAttributes}
          {...listeners}
        >
          <div
            className={cn(
              'relative -mb-px flex h-7 min-w-[90px] items-center rounded-t-[7px] text-[11.5px] transition-colors',
              isActive
                ? 'border-[var(--tab-border)] border-t border-r border-l bg-tab-active text-tab-fg-active'
                : 'bg-transparent text-tab-fg hover:text-tab-fg-active',
            )}
          >
            {/* Navigation area — fills the pill, triggers route change */}
            <button
              type="button"
              className="flex flex-1 cursor-pointer items-center gap-1.5 overflow-hidden pr-1 pl-3"
              onClick={() =>
                navigate({
                  to: '/$projectId/$tabId',
                  params: { projectId, tabId: tab.id },
                })
              }
            >
              {tab.running ? (
                <RunningDot />
              ) : (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-35" />
              )}
              <span className="truncate" style={{ fontFamily: MONO_FONT }}>
                {tab.label}
              </span>
            </button>

            {/* Pin / close action — sibling of nav button, not nested */}
            {tab.pinned ? (
              <button
                type="button"
                className="mr-1.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded opacity-40 hover:opacity-100"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleTabPin(projectId, tab.id)
                }}
              >
                <Pin size={9} />
              </button>
            ) : (
              <button
                type="button"
                className="mr-1.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded opacity-40 hover:bg-sidebar-hover hover:opacity-100"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  removeTab(projectId, tab.id)
                }}
              >
                <X size={9} />
              </button>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 text-[12px]">
        <ContextMenuItem onSelect={() => toggleTabPin(projectId, tab.id)}>
          {tab.pinned ? 'Unpin tab' : 'Pin tab'}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => removeTab(projectId, tab.id)}
          className="text-destructive"
        >
          Close tab
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/* ---------------------------------------------------------------------------
 * TabBar — horizontal DnD tab strip
 * -------------------------------------------------------------------------*/
export function TabBar({ project }: { project: Project }) {
  const navigate = useNavigate()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const orderedTabs = [
    ...project.tabs.filter((t) => t.pinned),
    ...project.tabs.filter((t) => !t.pinned),
  ]

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = orderedTabs.findIndex((t) => t.id === active.id)
    const newIdx = orderedTabs.findIndex((t) => t.id === over.id)
    if (orderedTabs[newIdx]?.pinned) return
    reorderTabs(project.id, oldIdx, newIdx)
  }

  function handleAddTab() {
    const newTab = addTab(project.id)
    if (newTab) {
      navigate({
        to: '/$projectId/$tabId',
        params: { projectId: project.id, tabId: newTab.id },
      })
    }
  }

  return (
    <div
      data-tauri-drag-region
      className="flex h-[38px] shrink-0 items-end border-[var(--tab-border)] border-b bg-tab-bar px-2"
      style={{ gap: 2 }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={orderedTabs.map((t) => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          {orderedTabs.map((t) => (
            <TabItem key={t.id} tab={t} projectId={project.id} />
          ))}
        </SortableContext>
      </DndContext>

      <button
        type="button"
        data-tauri-drag-region={undefined}
        className="-mb-px flex h-7 w-6 items-center justify-center rounded text-tab-fg hover:bg-sidebar-hover hover:text-tab-fg-active"
        onClick={handleAddTab}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 11 11"
          role="img"
          aria-label="New tab"
        >
          <path
            d="M5.5 1.5 V9.5 M1.5 5.5 H9.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div className="flex-1" data-tauri-drag-region />

      <div
        data-tauri-drag-region
        className="flex h-7 items-center pr-1"
        style={{ fontFamily: MONO_FONT, fontSize: 10.5 }}
      >
        <span className="pointer-events-none text-tab-fg opacity-50">
          {project.path}
        </span>
      </div>
    </div>
  )
}
