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
  const allTabMeta = useStore($tabMeta)
  const sessionsRunning = projects.reduce(
    (n, p) =>
      n +
      p.tabs.filter(
        (t) => allTabMeta[makeTabKey(p.id, t.id)]?.status === 'running',
      ).length,
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

      {/* Project tree */}
      <div className="flex-1 overflow-y-auto py-1.5">
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
