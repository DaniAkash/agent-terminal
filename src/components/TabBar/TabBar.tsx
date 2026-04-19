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
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Pin, X } from 'lucide-react'
import { RunningDot } from '@/components/RunningDot'
import { cn } from '@/lib/utils'
import {
  addTab,
  removeTab,
  reorderTabs,
  toggleTabPin,
} from '@/modules/stores/$projects'
import { MONO_FONT } from '@/screens/workspace/workspace.helpers'
import type { Project, Tab } from '@/screens/workspace/workspace.types'

// Set true for one event-loop tick after a drag completes so that the
// pointer-up → click sequence (which WKWebView does not suppress after DnD)
// cannot accidentally navigate to the tab the pointer was hovering over.
let tabDragJustEnded = false

/* ---------------------------------------------------------------------------
 * TabItem — single sortable tab pill
 * -------------------------------------------------------------------------*/
function TabItem({ tab, projectId }: { tab: Tab; projectId: string }) {
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

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 50 : undefined,
      }}
      {...attributes}
      {...listeners}
      onClickCapture={(e) => {
        if (tabDragJustEnded) e.stopPropagation()
      }}
    >
      <Link
        to="/$projectId/$tabId"
        params={{ projectId, tabId: tab.id }}
        className={cn(
          'relative -mb-px flex h-7 min-w-[90px] cursor-pointer items-center gap-1.5 rounded-t-[7px] px-3 text-[11.5px] transition-colors',
          isActive
            ? 'border-[var(--tab-border)] border-t border-r border-l bg-tab-active text-tab-fg-active'
            : 'bg-transparent text-tab-fg hover:text-tab-fg-active',
        )}
      >
        {tab.running ? (
          <RunningDot />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-35" />
        )}
        <span className="truncate" style={{ fontFamily: MONO_FONT }}>
          {tab.label}
        </span>
        {tab.pinned ? (
          <button
            type="button"
            className="ml-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded opacity-40 hover:opacity-100"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault()
              toggleTabPin(projectId, tab.id)
            }}
          >
            <Pin size={9} />
          </button>
        ) : (
          <button
            type="button"
            className="ml-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded opacity-40 hover:bg-sidebar-hover hover:opacity-100"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault()
              removeTab(projectId, tab.id)
            }}
          >
            <X size={9} />
          </button>
        )}
      </Link>
    </div>
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
    tabDragJustEnded = true
    setTimeout(() => {
      tabDragJustEnded = false
    }, 0)
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
