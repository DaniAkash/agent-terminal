import { useStore } from '@nanostores/react'
import { $projects } from '@/modules/stores/$projects'
import { Route } from '@/routes/$projectId/$tabId'
import { MONO_FONT } from '@/screens/workspace/workspace.helpers'

export function TerminalPlaceholder() {
  const { projectId } = Route.useParams()
  const projects = useStore($projects)
  const project = projects.find((p) => p.id === projectId)

  return (
    <div
      className="min-h-0 flex-1 bg-terminal p-[14px_18px_18px]"
      style={{ fontFamily: MONO_FONT, fontSize: 12.5, lineHeight: 1.55 }}
    >
      <div className="mb-2.5 text-[11.5px] text-terminal-muted">
        Last login: — · session not yet attached
      </div>
      <div className="flex items-center">
        <span className="text-terminal-green">➜</span>
        <span className="ml-1 text-terminal-prompt">
          {project?.path ?? '~'}
        </span>
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-[blink_1s_steps(2)_infinite] bg-terminal-fg" />
      </div>
    </div>
  )
}
