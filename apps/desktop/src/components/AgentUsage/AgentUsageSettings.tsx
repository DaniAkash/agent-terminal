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
import { AgentUsageIPC } from '@/modules/agent-usage/api'
import { installationLabel, STATUS_LABEL } from '@/modules/agent-usage/helpers'
import { $agentUsage, saveAgentUsagePreferences } from '@/modules/agent-usage/store'
import type { UsageSnapshot } from '@/modules/agent-usage/types'

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

export function AgentUsageSettings({ snapshot }: { snapshot: UsageSnapshot }) {
  const { saving } = useStore($agentUsage)
  const [scanning, setScanning] = useState(false)
  const prefs = snapshot.preferences
  const installed = snapshot.providers.filter(
    (provider) => provider.detected,
  ).length
  const providers = [...snapshot.providers].sort(
    (a, b) => Number(b.detected === true) - Number(a.detected === true),
  )
  return (
    <div className="agent-usage-settings">
      <div className="agent-usage-card agent-usage-controls space-y-4">
        <Toggle
          label="Enable Agent Usage limits"
          description="Use selected providers’ existing sessions to read account usage."
          checked={prefs.enabled}
          disabled={saving}
          onChange={(enabled) => void saveAgentUsagePreferences({ enabled })}
        />
        <div className="border-border/60 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <span className="flex shrink-0 items-center gap-2 text-[12px] whitespace-nowrap">
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
              className="border-input bg-popover text-popover-foreground focus-visible:ring-ring flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 font-mono text-[11px] whitespace-nowrap outline-none focus-visible:ring-2 disabled:opacity-50"
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
                  void saveAgentUsagePreferences({ refreshSeconds: Number(value) })
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
      <div className="agent-usage-settings-providers">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold">Providers</h3>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-7 text-xs"
            disabled={scanning}
            onClick={async () => {
              setScanning(true)
              try {
                await AgentUsageIPC.rescanAgents()
              } catch {
                $agentUsage.setKey(
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
        <p className="text-muted-foreground mb-3 text-xs">
          {installed} installed · Detected automatically. Enable usage for the
          agents you use.
        </p>
        <div className="agent-usage-settings-provider-list">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="agent-usage-card flex items-center gap-3"
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
                  void saveAgentUsagePreferences({ providers })
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <p className="agent-usage-settings-note border-border/60 text-muted-foreground border-t pt-3 text-[11px] leading-relaxed">
        Usage is reported by your provider account and may include other
        devices. Credentials stay on this device and are sent only to their own
        provider. Agent Usage limits does not save credentials, read browser cookies, or
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
        <span className="block text-[13px] font-medium">{label}</span>
        {status && (
          <span
            className="text-muted-foreground mt-1 block text-[11px]"
            aria-live="polite"
          >
            {status}
          </span>
        )}
        <span className="text-muted-foreground mt-1 block text-[11px] leading-relaxed">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="agent-usage-switch"
      />
    </label>
  )
}
