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
import { useParams } from '@tanstack/react-router'
import { ChevronRight, Folder, Pin } from 'lucide-react'
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
  $expanded,
  removeProject,
  reorderTabs,
  toggleExpanded,
  toggleProjectPin,
} from '@/modules/stores/$projects'
import type { Project } from '@/screens/workspace/workspace.types'

export function SidebarProjectRow({ project }: { project: Project }) {
  const expanded = useStore($expanded)
  const isOpen = !!expanded[project.id]
  const { projectId: activeProject } = useParams({ strict: false })
  const isActive = activeProject === project.id

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, disabled: project.pinned })

  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const orderedTabs = [
    ...project.tabs.filter((t) => t.pinned),
    ...project.tabs.filter((t) => !t.pinned),
  ]
  const anyRunning = project.tabs.some((t) => t.running)

  function handleTabDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = project.tabs.findIndex((t) => t.id === active.id)
    const newIdx = project.tabs.findIndex((t) => t.id === over.id)
    if (project.tabs[newIdx]?.pinned) return
    reorderTabs(project.id, oldIdx, newIdx)
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
    >
      <ContextMenu>
        <ContextMenuTrigger>
          <button
            type="button"
            className={cn(
              'mx-1.5 flex h-[26px] w-[calc(100%-12px)] cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 text-[12.5px]',
              isActive
                ? 'bg-sidebar-active text-sidebar-fg-strong'
                : 'text-sidebar-fg hover:bg-sidebar-hover',
            )}
            onClick={() => toggleExpanded(project.id)}
          >
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 cursor-grab items-center justify-center rounded transition-transform duration-[140ms]',
                project.pinned && 'cursor-default',
                isOpen && 'rotate-90',
              )}
              {...(!project.pinned ? listeners : {})}
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
            <span className="flex-1 truncate font-medium">{project.name}</span>
            {anyRunning && !isOpen && <RunningDot />}
            {project.pinned && <Pin size={9} className="shrink-0 opacity-50" />}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44 text-[12px]">
          <ContextMenuItem onSelect={() => toggleProjectPin(project.id)}>
            {project.pinned ? 'Unpin project' : 'Pin project'}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => removeProject(project.id)}
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
