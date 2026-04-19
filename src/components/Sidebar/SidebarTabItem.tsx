import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Pin } from 'lucide-react'
import { RunningDot } from '@/components/RunningDot'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { toggleTabPin } from '@/modules/stores/$projects'
import { MONO_FONT } from '@/screens/workspace/workspace.helpers'
import type { Tab } from '@/screens/workspace/workspace.types'

export function SidebarTabItem({
  tab,
  projectId,
}: {
  tab: Tab
  projectId: string
}) {
  const navigate = useNavigate()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id, disabled: tab.pinned })
  const { projectId: activeProject, tabId: activeTab } = useParams({
    strict: false,
  })
  const isActive = activeProject === projectId && activeTab === tab.id

  // Strip role so Biome doesn't see a static role="button" on a div
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
          }}
          {...safeAttributes}
          {...listeners}
        >
          <button
            type="button"
            className={cn(
              'relative mx-1.5 flex h-[26px] w-[calc(100%-12px)] items-center gap-2 rounded-md pr-2 pl-[34px]',
              isActive
                ? 'bg-sidebar-active text-sidebar-fg-strong'
                : 'text-sidebar-fg hover:bg-sidebar-hover',
            )}
            onClick={() =>
              navigate({
                to: '/$projectId/$tabId',
                params: { projectId, tabId: tab.id },
              })
            }
          >
            {isActive && (
              <span className="absolute top-1.5 bottom-1.5 left-3.5 w-0.5 rounded-sm bg-accent" />
            )}
            <span
              className={cn('flex-1 truncate', isActive && 'font-medium')}
              style={{ fontFamily: MONO_FONT, fontSize: 11.5 }}
            >
              {tab.label}
            </span>
            {tab.running && <RunningDot />}
            {tab.pinned && <Pin size={9} className="shrink-0 opacity-50" />}
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 text-[12px]">
        <ContextMenuItem onSelect={() => toggleTabPin(projectId, tab.id)}>
          {tab.pinned ? 'Unpin tab' : 'Pin tab'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
