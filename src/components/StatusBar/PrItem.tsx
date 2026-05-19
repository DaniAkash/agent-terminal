import { openUrl } from '@tauri-apps/plugin-opener'
import {
  GitMerge,
  GitPullRequestArrow,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from 'lucide-react'
import { Fragment } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { GitInfo, PrChecks, PrInfo } from '@/modules/stores/$tabMeta'
import { MONO_FONT } from '@/screens/workspace/workspace.helpers'

/* ---------------------------------------------------------------------------
 * PrItem — status bar pill for the PR linked to the active tab's branch.
 *
 * Layout (left to right inside the pill):
 *   [checks dot]  [state icon]  #<num>  <truncated title>
 *
 * The whole pill is a single button — click opens the PR in the OS default
 * browser. Hover surfaces a tooltip with the full title, state label,
 * ahead/behind echo, and a 4-bucket check breakdown.
 *
 * Refresh cadence is driven by GitMonitorMod on the Rust side: 60s baseline,
 * 15s while `checks.pending > 0` so active CI runs surface quickly without
 * adding a separate polling task. The OSC 133;D trigger keeps things
 * sub-second after any shell command that could change PR state (push,
 * commit, force-push, gh pr ready, etc.).
 * -------------------------------------------------------------------------*/

/** Max chars for the inline title before truncating with an ellipsis. */
export const TITLE_MAX = 40

/**
 * Truncate by Unicode code points (not UTF-16 code units) so a title ending
 * with an emoji or other astral character at the boundary doesn't get cut
 * mid surrogate-pair and render as a replacement glyph. Realistic for PR
 * titles that follow gitmoji or similar conventions.
 */
export function truncate(s: string, n: number): string {
  const codePoints = Array.from(s)
  if (codePoints.length <= n) return s
  return `${codePoints.slice(0, n - 1).join('')}…`
}

export function stateLabel(pr: PrInfo): string {
  if (pr.state === 'MERGED') return 'merged'
  if (pr.state === 'CLOSED') return 'closed'
  return pr.isDraft ? 'draft' : 'open'
}

/**
 * The colour for the PR icon and number, matching github.com's familiar
 * palette: green open, red closed, purple merged, grey draft. Sourced from
 * Primer tokens via CSS variables in index.css (light + dark variants).
 */
export function stateColor(pr: PrInfo): string {
  if (pr.state === 'MERGED') return 'var(--pr-merged)'
  if (pr.state === 'CLOSED') return 'var(--pr-closed)'
  if (pr.isDraft) return 'var(--pr-draft)'
  return 'var(--pr-open)'
}

/**
 * Picks the state icon. Order matters: MERGED and CLOSED take precedence
 * over isDraft because a draft that gets merged still reads as "merged."
 */
function StateIcon({ pr }: { pr: PrInfo }) {
  const sz = { size: 10, strokeWidth: 1.5 } as const
  const color = stateColor(pr)
  if (pr.state === 'MERGED') {
    return (
      <GitMerge
        aria-hidden="true"
        {...sz}
        className="shrink-0"
        style={{ color }}
        data-testid="pr-icon-merged"
      />
    )
  }
  if (pr.state === 'CLOSED') {
    return (
      <GitPullRequestClosed
        aria-hidden="true"
        {...sz}
        className="shrink-0"
        style={{ color }}
        data-testid="pr-icon-closed"
      />
    )
  }
  if (pr.isDraft) {
    return (
      <GitPullRequestDraft
        aria-hidden="true"
        {...sz}
        className="shrink-0"
        style={{ color }}
        data-testid="pr-icon-draft"
      />
    )
  }
  return (
    <GitPullRequestArrow
      aria-hidden="true"
      {...sz}
      className="shrink-0"
      style={{ color }}
      data-testid="pr-icon-open"
    />
  )
}

/**
 * Returns the colour of the build-health dot, or `null` to hide it.
 * Hidden when:
 *   - no checks data yet (`checks` undefined — first poll hasn't returned a rollup)
 *   - rollup reports zero items (repo has no CI configured for this PR)
 *
 * SKIPPED is treated as success — skipped checks are intentional (matrix
 * gating, path filters), and showing red because half the runners were
 * filtered out would be wrong.
 */
export function checksColor(checks: PrChecks | undefined): string | null {
  if (!checks || checks.total === 0) return null
  if (checks.failing > 0) return 'var(--terminal-red)'
  if (checks.pending > 0) return 'var(--terminal-yellow)'
  return 'var(--terminal-green)'
}

/** Single-row check breakdown for the tooltip body. */
function ChecksBreakdown({ checks }: { checks: PrChecks | undefined }) {
  if (!checks || checks.total === 0) {
    return (
      <span className="opacity-60" data-testid="pr-checks-empty">
        no checks reported
      </span>
    )
  }
  // Dim zero-count categories rather than dropping them entirely — keeps
  // the layout stable so the eye doesn't have to re-parse on each refresh.
  const parts: Array<{ key: string; node: React.ReactNode }> = [
    {
      key: 'p',
      node: (
        <span className={checks.passing > 0 ? '' : 'opacity-40'}>
          ✓ {checks.passing} passing
        </span>
      ),
    },
    {
      key: 'f',
      node: (
        <span
          className={
            checks.failing > 0 ? 'text-[var(--terminal-red)]' : 'opacity-40'
          }
        >
          ✗ {checks.failing} failing
        </span>
      ),
    },
    {
      key: 'i',
      node: (
        <span
          className={
            checks.pending > 0 ? 'text-[var(--terminal-yellow)]' : 'opacity-40'
          }
        >
          ◐ {checks.pending} pending
        </span>
      ),
    },
  ]
  if (checks.skipped > 0) {
    parts.push({
      key: 's',
      node: <span className="opacity-60">⊘ {checks.skipped} skipped</span>,
    })
  }
  return (
    <span
      className="flex flex-wrap items-center gap-2"
      data-testid="pr-checks-breakdown"
    >
      {parts.map((p, i) => (
        <Fragment key={p.key}>
          {i > 0 && <span className="opacity-30">·</span>}
          {p.node}
        </Fragment>
      ))}
      <span className="opacity-30">·</span>
      <span className="opacity-60">{checks.total} total</span>
    </span>
  )
}

export function PrItem({ git }: { git: GitInfo }) {
  const pr = git.pr
  if (!pr) return null

  const dotColor = checksColor(pr.checks)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          onClick={(e) => {
            e.preventDefault()
            openUrl(pr.url).catch(() => {})
          }}
          className="flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-[11px] text-inherit hover:opacity-100"
          style={{ fontFamily: MONO_FONT, opacity: 0.85 }}
          aria-label={`Pull request #${pr.number}: ${pr.title}`}
          data-testid="pr-pill"
        >
          {dotColor && (
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: dotColor }}
              data-testid="pr-checks-dot"
            />
          )}
          <StateIcon pr={pr} />
          <span style={{ color: stateColor(pr) }}>#{pr.number}</span>
          <span className="truncate opacity-80">
            {truncate(pr.title, TITLE_MAX)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[28rem]">
          <div
            className="flex flex-col gap-1 text-[11px]"
            style={{ fontFamily: MONO_FONT }}
          >
            <div className="font-medium">{pr.title}</div>
            <div className="opacity-70">
              #{pr.number} · {stateLabel(pr)}
              {(git.aheadBy > 0 || git.behindBy > 0) && (
                <>
                  {' · '}
                  {git.aheadBy} ahead, {git.behindBy} behind
                </>
              )}
            </div>
            <ChecksBreakdown checks={pr.checks} />
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
