import { useEffect, useReducer } from 'react'
import {
  isCurrent,
  prioritizeProvider,
  quotaRings,
  STATUS_LABEL,
} from '@/modules/agent-usage/helpers'
import type {
  ProviderUsage,
  UsageSnapshot,
  UsageWindow,
} from '@/modules/agent-usage/types'

/** A compact provider strip: outer weekly arc, inner dotted short-term arc. */
export function AgentUsageHover({
  snapshot,
  priorityProviderId,
}: {
  snapshot: UsageSnapshot | null
  priorityProviderId?: string | null
}) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const providers =
    snapshot?.providers.filter(
      (provider) =>
        provider.detected ||
        provider.id === priorityProviderId ||
        snapshot.preferences.providers.includes(provider.id) ||
        provider.status === 'available',
    ) ?? []
  return (
    <div className="agent-usage-surface agent-usage-hover-strip border-border text-popover-foreground rounded-lg border p-2 shadow-lg">
      {providers.length ? (
        prioritizeProvider(providers, priorityProviderId).map((provider) => (
          <ProviderGauge key={provider.id} provider={provider} />
        ))
      ) : (
        <p className="text-muted-foreground col-span-full px-3 py-2 text-xs">
          {snapshot ? 'No providers · Click to configure' : 'Loading…'}
        </p>
      )}
    </div>
  )
}

function remaining(window: UsageWindow | undefined) {
  return window ? Math.max(0, Math.min(100, 100 - window.usedPercent)) : null
}

function ProviderGauge({ provider }: { provider: ProviderUsage }) {
  const { weekly, hourly } = quotaRings(provider)
  const week = remaining(weekly)
  const hour = remaining(hourly)
  const stale =
    provider.status === 'stale' ||
    (provider.status === 'available' && !isCurrent(provider))
  const readable =
    provider.status === 'available' || provider.status === 'stale'
  const ringColor = stale ? 'var(--muted-foreground)' : 'var(--foreground)'
  const describe = (
    window: UsageWindow | undefined,
    value: number | null,
    fallback: string,
  ) =>
    `${window?.label ?? fallback}: ${value === null ? 'unavailable' : `${Math.round(value)}% left`}`
  const label = `${provider.name}. ${describe(weekly, week, 'Weekly')}. ${describe(hourly, hour, 'Hourly')}. ${stale ? 'Last known' : STATUS_LABEL[provider.status]}`
  return (
    <figure className="min-w-0 text-center" title={label}>
      <svg
        viewBox="0 0 100 80"
        className="mx-auto w-full max-w-28"
        role="img"
        aria-label={label}
      >
        <path
          d="M 15.36 69 A 40 40 0 1 1 84.64 69"
          pathLength="100"
          fill="none"
          stroke="var(--agent-usage-empty-dot)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {readable && week !== null && week > 0 && (
          <path
            d="M 15.36 69 A 40 40 0 1 1 84.64 69"
            pathLength="100"
            fill="none"
            stroke={ringColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${week} 100`}
          />
        )}
        {Array.from({ length: 21 }, (_, index) => {
          const angle = ((150 + index * 12) * Math.PI) / 180
          const fill =
            readable && hour !== null
              ? Math.min(1, Math.max(0, (hour / 100) * 21 - index))
              : 0
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed gauge dots never reorder
            <g key={index}>
              <circle
                cx={50 + Math.cos(angle) * 31}
                cy={49 + Math.sin(angle) * 31}
                r="1.8"
                fill="var(--agent-usage-empty-dot)"
              />
              <circle
                cx={50 + Math.cos(angle) * 31}
                cy={49 + Math.sin(angle) * 31}
                r="1.8"
                fill={ringColor}
                opacity={fill}
              />
            </g>
          )
        })}
        <text
          x="50"
          y="48"
          textAnchor="middle"
          fill={ringColor}
          fontFamily="var(--font-mono)"
          fontSize="15"
        >
          {readable && hour !== null ? `${Math.round(hour)}%` : '—'}
        </text>
        <text
          x="50"
          y="62"
          textAnchor="middle"
          fill="var(--muted-foreground)"
          fontSize="8"
        >
          {readable
            ? `W ${week === null ? '—' : `${Math.round(week)}%`}`
            : STATUS_LABEL[provider.status]}
        </text>
      </svg>
      <figcaption className="truncate text-[11px] font-medium">
        {provider.id === 'claude-code' ? 'Claude' : provider.name}
      </figcaption>
    </figure>
  )
}
