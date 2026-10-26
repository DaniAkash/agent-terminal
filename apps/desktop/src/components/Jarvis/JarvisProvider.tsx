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
} from '@/modules/jarvis/helpers'
import { $jarvis, authorizeClaudeKeychain } from '@/modules/jarvis/store'
import type { ProviderUsage, UsageWindow } from '@/modules/jarvis/types'

export function JarvisProvider({ provider }: { provider: ProviderUsage }) {
  const { snapshot, authorizing } = useStore($jarvis)
  const stale =
    provider.status === 'stale' ||
    (provider.status === 'available' && !isCurrent(provider))
  return (
    <section
      className="jarvis-card jarvis-provider"
      data-status={stale ? 'stale' : provider.status}
    >
      <div className="jarvis-provider-header">
        <div className="flex items-center gap-2">
          <AgentGlyph
            visual={agentBrandVisual(provider.id)}
            monochrome
            size={18}
          />
          <div>
            <h3 className="font-semibold text-[15px]">{provider.name}</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {installationLabel(provider.detected)}
            </p>
          </div>
        </div>
        <span className="jarvis-provider-status">
          <span aria-hidden="true" className="jarvis-status-dot" />
          {stale ? 'Last known' : STATUS_LABEL[provider.status]}
        </span>
      </div>
      <div className="jarvis-windows">
        {provider.windows.map((window) => (
          <WindowMeter key={window.id} window={window} stale={stale} />
        ))}
      </div>
      {provider.message && (
        <p className="mt-2 text-muted-foreground text-xs leading-relaxed">
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
        <p className="jarvis-provider-updated" title={provider.source}>
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
    <div className="jarvis-window">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-medium text-xs">{window.label}</span>
        <span className="jarvis-reading" style={{ color }}>
          {Math.round(remaining)}
          <span className="text-[13px]">%</span>
          <span className="ml-1.5 font-normal text-[11px] text-muted-foreground">
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
        className="jarvis-meter"
        style={{ opacity: stale ? 0.5 : 1 }}
      >
        {Array.from({ length: 20 }, (_, index) => {
          const fill = Math.min(100, Math.max(0, (remaining / 5 - index) * 100))
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed quota dots never reorder
              key={index}
              className="jarvis-meter-dot"
              style={{
                background: `linear-gradient(90deg, ${color} ${fill}%, var(--jarvis-empty-dot) ${fill}%)`,
              }}
            />
          )
        })}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
