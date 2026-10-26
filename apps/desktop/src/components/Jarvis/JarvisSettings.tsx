import { useStore } from '@nanostores/react'
import { ChevronDown, Timer } from 'lucide-react'
import { useState } from 'react'
import { AgentGlyph } from '@/components/AgentGlyph'
import { agentBrandVisual } from '@/components/agent.helpers'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { JarvisIPC } from '@/modules/jarvis/api'
import { installationLabel, STATUS_LABEL } from '@/modules/jarvis/helpers'
import { $jarvis, saveJarvisPreferences } from '@/modules/jarvis/store'
import type { UsageSnapshot } from '@/modules/jarvis/types'

const SOURCES: Record<string, string> = {
  codex: 'Account and model limits',
  'claude-code': 'Session and weekly limits',
  opencode: 'OpenCode Go quotas',
  amp: 'Free and subscription allowances',
  kilo: 'Kilo Pass allowance',
  kimi: 'Coding allowances',
  mastracode: 'Quota belongs to your configured model provider',
}

const INTERVALS = [
  { value: 0, label: 'Manual' },
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 900, label: 'Every 15 minutes' },
]

export function JarvisSettings({ snapshot }: { snapshot: UsageSnapshot }) {
  const { saving } = useStore($jarvis)
  const [scanning, setScanning] = useState(false)
  const prefs = snapshot.preferences
  const installed = snapshot.providers.filter(
    (provider) => provider.detected,
  ).length
  const providers = [...snapshot.providers].sort(
    (a, b) => Number(b.detected === true) - Number(a.detected === true),
  )
  return (
    <div className="jarvis-settings">
      <div className="jarvis-card jarvis-controls space-y-4">
        <Toggle
          label="Enable Jarvis"
          description="Use selected providers’ existing sessions to read account usage."
          checked={prefs.enabled}
          disabled={saving}
          onChange={(enabled) => void saveJarvisPreferences({ enabled })}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-border/60 border-t pt-3">
          <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[12px]">
            <Timer
              size={13}
              className="text-muted-foreground"
              aria-hidden="true"
            />
            Refresh usage
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={saving || !prefs.enabled}
              aria-label="Refresh interval"
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-input bg-popover px-2.5 py-1.5 font-mono text-[11px] text-popover-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {
                INTERVALS.find(
                  (interval) => interval.value === prefs.refreshSeconds,
                )?.label
              }
              <ChevronDown
                size={12}
                aria-hidden="true"
                className="text-muted-foreground"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuRadioGroup
                value={String(prefs.refreshSeconds)}
                onValueChange={(value) =>
                  void saveJarvisPreferences({ refreshSeconds: Number(value) })
                }
              >
                {INTERVALS.map((interval) => (
                  <DropdownMenuRadioItem
                    key={interval.value}
                    value={String(interval.value)}
                    disabled={saving || !prefs.enabled}
                    className="px-3 py-2 text-[11px]"
                  >
                    {interval.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="jarvis-settings-providers">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="font-semibold text-[13px]">Providers</h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-muted-foreground text-xs"
            disabled={scanning}
            onClick={async () => {
              setScanning(true)
              try {
                await JarvisIPC.rescanAgents()
              } catch {
                $jarvis.setKey(
                  'error',
                  'Could not scan installed agents. Try again.',
                )
              } finally {
                setScanning(false)
              }
            }}
          >
            {scanning ? 'Scanning…' : 'Rescan'}
          </Button>
        </div>
        <p className="mb-3 text-muted-foreground text-xs">
          {installed} installed · Detected automatically. Enable usage for the
          agents you use.
        </p>
        <div className="jarvis-settings-provider-list">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="jarvis-card flex items-center gap-3"
            >
              <AgentGlyph
                visual={agentBrandVisual(provider.id)}
                monochrome
                size={18}
              />
              <Toggle
                label={provider.name}
                status={
                  prefs.enabled && prefs.providers.includes(provider.id)
                    ? `${installationLabel(provider.detected)} · ${STATUS_LABEL[provider.status]}`
                    : installationLabel(provider.detected)
                }
                description={SOURCES[provider.id] ?? 'Local provider session'}
                checked={prefs.providers.includes(provider.id)}
                disabled={saving || !prefs.enabled}
                onChange={(enabled) => {
                  const providers = enabled
                    ? [...prefs.providers, provider.id]
                    : prefs.providers.filter((id) => id !== provider.id)
                  void saveJarvisPreferences({ providers })
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <p className="jarvis-settings-note border-border/60 border-t pt-3 text-[11px] text-muted-foreground leading-relaxed">
        Usage is reported by your provider account and may include other
        devices. Credentials stay on this device and are sent only to their own
        provider. Jarvis does not save credentials, read browser cookies, or
        collect token history.
      </p>
    </div>
  )
}

function Toggle({
  label,
  description,
  status,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description: string
  status?: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex w-full cursor-pointer items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block font-medium text-[13px]">{label}</span>
        {status && (
          <span
            className="mt-1 block text-[11px] text-muted-foreground"
            aria-live="polite"
          >
            {status}
          </span>
        )}
        <span className="mt-1 block text-[11px] text-muted-foreground leading-relaxed">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="jarvis-switch"
      />
    </label>
  )
}
