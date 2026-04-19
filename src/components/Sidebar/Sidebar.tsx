import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useStore } from '@nanostores/react'
import { $projects, reorderProjects } from '@/modules/stores/$projects'
import { SidebarProjectRow } from './SidebarProjectRow'

export function Sidebar() {
  const projects = useStore($projects)
  const sessionsRunning = projects.reduce(
    (n, p) => n + p.tabs.filter((t) => t.running).length,
    0,
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const ordered = [
    ...projects.filter((p) => p.pinned),
    ...projects.filter((p) => !p.pinned),
  ]

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = projects.findIndex((p) => p.id === active.id)
    const newIndex = projects.findIndex((p) => p.id === over.id)
    if (projects[newIndex]?.pinned) return
    reorderProjects(oldIndex, newIndex)
  }

  return (
    <div className="flex h-full w-[232px] min-w-[232px] flex-col border-sidebar-border border-r bg-sidebar">
      {/* Header — drag region, reserves traffic-light space */}
      <div
        data-tauri-drag-region
        className="flex h-[38px] shrink-0 items-center border-sidebar-border border-b px-3 pl-[78px]"
      >
        <span
          className="font-medium text-[12px] text-sidebar-fg"
          style={{ letterSpacing: '0.01em' }}
        >
          Workspaces
        </span>
      </div>

      {/* Project tree */}
      <div className="flex-1 overflow-y-auto py-1.5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={ordered.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {ordered.map((p) => (
              <SidebarProjectRow key={p.id} project={p} />
            ))}
          </SortableContext>
        </DndContext>

        <button
          type="button"
          className="mx-1.5 mt-1 flex h-[26px] w-[calc(100%-12px)] items-center gap-1.5 rounded-md px-3 text-[12px] text-sidebar-fg opacity-70 hover:bg-sidebar-hover hover:opacity-100"
        >
          <span className="text-[13px] leading-none">+</span>
          <span>Add project…</span>
        </button>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-sidebar-border border-t px-3 py-2 text-[11.5px] text-sidebar-fg">
        <div
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-semibold text-[10px] text-white tracking-wide"
          style={{
            background:
              'linear-gradient(135deg, var(--accent), var(--terminal-magenta))',
          }}
        >
          DA
        </div>
        <div className="flex flex-1 flex-col leading-tight">
          <span className="font-medium text-sidebar-fg-strong">dani.akash</span>
          <span className="text-[10px] opacity-70">
            {sessionsRunning} sessions running
          </span>
        </div>
      </div>
    </div>
  )
}
