import { useStore } from '@nanostores/react'
import { Clock3 } from 'lucide-react'
import { AgentGlyph } from '@/components/AgentGlyph'
import { agentBrandVisual } from '@/components/agent.helpers'
import { Button } from '@/components/ui/button'
import {
  capturedLabel,
  installationLabel,
  isCurrent,
  resetLabel,
  STATUS_LABEL,
  usageColor,
} from '@/modules/agent-usage/helpers'
import {
  $agentUsage,
  authorizeClaudeKeychain,
} from '@/modules/agent-usage/store'
import type { ProviderUsage, UsageWindow } from '@/modules/agent-usage/types'

export function AgentUsageProvider({ provider }: { provider: ProviderUsage }) {
  const { snapshot, authorizing } = useStore($agentUsage)
  const stale =
    provider.status === 'stale' ||
    (provider.status === 'available' && !isCurrent(provider))
  return (
    <section
      className="agent-usage-card agent-usage-provider"
      data-status={stale ? 'stale' : provider.status}
    >
      <div className="agent-usage-provider-header">
        <div className="flex items-center gap-2">
          <AgentGlyph
            visual={agentBrandVisual(provider.id)}
            monochrome
            size={18}
          />
          <div>
            <h3 className="text-[15px] font-semibold">{provider.name}</h3>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              {installationLabel(provider.detected)}
            </p>
          </div>
        </div>
        <span className="agent-usage-provider-status">
          <span aria-hidden="true" className="agent-usage-status-dot" />
          {stale ? 'Last known' : STATUS_LABEL[provider.status]}
        </span>
      </div>
      <div className="agent-usage-windows">
        {provider.windows.map((window) => (
          <WindowMeter key={window.id} window={window} stale={stale} />
        ))}
      </div>
      {provider.message && (
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
          {provider.message}
        </p>
      )}
      {provider.status === 'pending' && (
        <p className="text-muted-foreground text-xs">
          Reading the provider’s existing session…
        </p>
      )}
      {snapshot?.claudeKeychainSupported &&
        provider.id === 'claude-code' &&
        provider.status === 'not_configured' && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 text-xs"
            disabled={authorizing}
            onClick={() => void authorizeClaudeKeychain()}
          >
            {authorizing
              ? 'Waiting for Keychain…'
              : 'Authorize Keychain access'}
          </Button>
        )}
      {provider.source && (
        <p className="agent-usage-provider-updated" title={provider.source}>
          {capturedLabel(provider.updatedAt)}
        </p>
      )}
    </section>
  )
}

function WindowMeter({
  window,
  stale,
}: {
  window: UsageWindow
  stale: boolean
}) {
  const remaining = Math.max(0, 100 - window.usedPercent)
  const color = stale
    ? 'var(--muted-foreground)'
    : usageColor(window.usedPercent)
  return (
    <div className="agent-usage-window">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium">{window.label}</span>
        <span className="agent-usage-reading" style={{ color }}>
          {Math.round(remaining)}
          <span className="text-[13px]">%</span>
          <span className="text-muted-foreground ml-1.5 text-[11px] font-normal">
            left
          </span>
        </span>
      </div>
      <meter
        min={0}
        max={100}
        value={remaining}
        aria-label={`${window.label}, remaining allowance${stale ? ', last known' : ''}`}
        className="sr-only"
      />
      <div
        aria-hidden="true"
        className="agent-usage-meter"
        style={{ opacity: stale ? 0.5 : 1 }}
      >
        {Array.from({ length: 20 }, (_, index) => {
          const fill = Math.min(100, Math.max(0, (remaining / 5 - index) * 100))
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed quota dots never reorder
              key={index}
              className="agent-usage-meter-dot"
              style={{
                background: `linear-gradient(90deg, ${color} ${fill}%, var(--agent-usage-empty-dot) ${fill}%)`,
              }}
            />
          )
        })}
      </div>
      <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-[11px]">
        <Clock3 size={11} aria-hidden="true" />
        <span
          title={
            window.resetsAt
              ? new Date(window.resetsAt * 1000).toLocaleString()
              : undefined
          }
        >
          {resetLabel(window.resetsAt)}
        </span>
      </p>
    </div>
  )
}
