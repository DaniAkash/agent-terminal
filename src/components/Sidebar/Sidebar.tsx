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
import {
  $activeProjectId,
  $activeTabId,
  navigateToProject,
  navigateToTab,
} from '@/modules/stores/$navigation'
import {
  $projects,
  addProject,
  reorderProjects,
} from '@/modules/stores/$projects'
import { $tabMeta } from '@/modules/stores/$tabMeta'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'
import { SidebarProjectRow } from './SidebarProjectRow'

export function Sidebar() {
  const projects = useStore($projects)

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
    if (projects[oldIndex]?.pinned !== projects[newIndex]?.pinned) return
    reorderProjects(oldIndex, newIndex)
  }

  function handleAddProject() {
    const projectId = $activeProjectId.get()
    const tabId = $activeTabId.get()[projectId]
    const cwd = tabId
      ? ($tabMeta.get()[makeTabKey(projectId, tabId)]?.cwd ?? '')
      : ''
    const project = addProject(cwd || undefined)
    navigateToProject(project.id)
    navigateToTab(project.id, 'shell')
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

      {/* Project tree — scrolls vertically; scrollbar hidden, bottom shadow
          gives a visual cue when more content exists below. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
              <p className="text-[12px] text-sidebar-fg opacity-60">
                No projects yet.
              </p>
              <p className="text-[11px] text-sidebar-fg opacity-40">
                Click below to add your first project.
              </p>
            </div>
          ) : (
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
          )}

          <button
            type="button"
            onClick={handleAddProject}
            className="mx-1.5 mt-1 flex h-[26px] w-[calc(100%-12px)] items-center gap-1.5 rounded-md px-3 text-[12px] text-sidebar-fg opacity-70 hover:bg-sidebar-hover hover:opacity-100"
          >
            <span className="text-[13px] leading-none">+</span>
            <span>New project</span>
          </button>
        </div>

        {/* Bottom shadow — signals overflowing project rows */}
        <div
          className="pointer-events-none absolute right-0 bottom-0 left-0 h-8"
          style={{
            background:
              'linear-gradient(to top, var(--color-sidebar) 20%, transparent)',
          }}
        />
      </div>
    </div>
  )
}
