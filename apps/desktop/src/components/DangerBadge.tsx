import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * 🤘 badge shown when an agent tab is running with full permissions.
 *
 * - claude-code: --dangerously-skip-permissions
 * - codex:       --yolo
 *
 * The badge and tooltip are the same regardless of which flag triggered it.
 *
 * Uses the shadcn Tooltip (base-ui under the hood) so the hover hint matches
 * the rest of the app's tooltips — consistent styling and timing — instead of
 * the OS-default native `title` attribute.
 */
export function DangerBadge({ size = 12 }: { size?: number }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="inline-flex shrink-0 items-center justify-center leading-none"
              style={{ fontSize: size }}
            >
              🤘
            </span>
          }
        />
        <TooltipContent side="top">All permissions enabled</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
