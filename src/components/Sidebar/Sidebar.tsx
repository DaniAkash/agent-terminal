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
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { navigateToProject, navigateToTab } from '@/modules/stores/$navigation'
import {
  $expanded,
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
  const [dialogOpen, setDialogOpen] = useState(false)
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
    if (projects[newIndex]?.pinned) return
    reorderProjects(oldIndex, newIndex)
  }

  function handleProjectAdded(project: ReturnType<typeof addProject>) {
    setDialogOpen(false)
    navigateToProject(project.id)
    navigateToTab(project.id, 'shell')
    $expanded.set({ ...$expanded.get(), [project.id]: true })
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
              Add your first project to get started.
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
          onClick={() => setDialogOpen(true)}
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

      <AddProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdded={handleProjectAdded}
      />
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * AddProjectDialog — shadcn Dialog with name + path fields and folder picker
 * -------------------------------------------------------------------------*/

type AddProjectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (project: ReturnType<typeof addProject>) => void
}

function AddProjectDialog({
  open,
  onOpenChange,
  onAdded,
}: AddProjectDialogProps) {
  const projects = useStore($projects)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState('')

  function reset() {
    setName('')
    setPath('')
    setError('')
  }

  async function browse() {
    const selected = await openDialog({ directory: true, multiple: false })
    if (typeof selected === 'string') {
      setPath(selected)
      if (!name.trim()) {
        const parts = selected.split('/')
        setName(parts[parts.length - 1] ?? '')
      }
    }
  }

  function submit() {
    const n = name.trim()
    const p = path.trim()
    if (!n || !p) {
      setError('Name and path are required')
      return
    }
    if (projects.some((proj) => proj.path === p)) {
      setError('This path is already added')
      return
    }
    const project = addProject(n, p)
    reset()
    onAdded(project)
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) reset()
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[340px] gap-4 text-[13px]">
        <DialogHeader>
          <DialogTitle className="text-[13px]">Add project</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="proj-name" className="text-[12px]">
              Name
            </Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="Project name"
              autoFocus
              className="h-8 text-[12px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="proj-path" className="text-[12px]">
              Path
            </Label>
            <div className="flex gap-2">
              <Input
                id="proj-path"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value)
                  setError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
                placeholder="~/path/to/folder"
                className="h-8 flex-1 text-[12px]"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 text-[12px]"
                onClick={browse}
              >
                Browse
              </Button>
            </div>
          </div>

          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-[12px]"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="text-[12px]"
            onClick={submit}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
