import { useStore } from '@nanostores/react'
import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { $theme, setTheme, type Theme } from '@/modules/stores/$theme'

type ThemeOption = {
  value: Theme
  label: string
  icon: typeof Sun
}

const OPTIONS: readonly ThemeOption[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

function getThemeMeta(theme: Theme): ThemeOption {
  // Explicit switch returns ThemeOption unconditionally — avoids the
  // `find() ?? OPTIONS[0]` pattern that returns `T | undefined` under
  // strict index access settings.
  switch (theme) {
    case 'light':
      return OPTIONS[1]
    case 'dark':
      return OPTIONS[2]
    default:
      return OPTIONS[0]
  }
}

export function ThemeToggle() {
  const theme = useStore($theme)
  const meta = getThemeMeta(theme)
  const CurrentIcon = meta.icon

  return (
    <DropdownMenu>
      {/* Single trigger element: a real <button>. The previous shape nested
          a TooltipTrigger span around a DropdownMenuTrigger span (both with
          nativeButton={false} + aria-label), giving screen readers two
          overlapping triggers. Dropped the tooltip — the icon + chevron +
          aria-label are self-explanatory and clicking opens the labelled
          dropdown anyway. */}
      <DropdownMenuTrigger
        render={(triggerProps) => (
          <button
            type="button"
            {...triggerProps}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'group gap-1.5 px-2.5 font-medium text-[11px] text-muted-foreground',
              triggerProps.className,
            )}
            style={{
              fontFamily: 'var(--font-ui)',
              ...(triggerProps.style ?? {}),
            }}
            aria-label="Theme settings"
          >
            <CurrentIcon size={14} aria-hidden="true" className="shrink-0" />
            <ChevronDown
              size={12}
              aria-hidden="true"
              className={cn(
                'origin-center opacity-60 transition-transform duration-150',
                'group-data-[popup-open]:rotate-180',
              )}
            />
          </button>
        )}
      />

      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="min-w-32 p-0.5"
        style={{ fontFamily: 'var(--font-ui)' }}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-1.5 pt-1 pb-0.5 font-semibold text-[9px] uppercase leading-none tracking-[0.16em]">
            Theme
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {OPTIONS.map((option) => {
            const Icon = option.icon
            const checked = theme === option.value
            return (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setTheme(option.value)}
                className="w-full justify-between gap-2 py-0.5 pr-1.5 text-[11px]"
              >
                <span className="flex items-center gap-1.5">
                  <Icon aria-hidden="true" size={12} className="shrink-0" />
                  {option.label}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'text-foreground/70 transition-opacity',
                    checked ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  ✓
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
