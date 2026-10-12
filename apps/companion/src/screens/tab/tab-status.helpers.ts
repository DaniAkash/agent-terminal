/**
 * The wire's `agent_state` rendered as the same five-state glyph the
 * desktop's TabStatusIcon shows, so a session looks the same on both.
 */
export type TabGlyph = 'running' | 'awaiting' | 'done' | 'error' | 'idle'

/**
 * How long a finished turn keeps its green dot. Matches the desktop's
 * per-tab timer, which clears `doneAt` on the same schedule.
 */
export const DONE_LINGER_MS = 10_000

/**
 * Pick the glyph for a tab.
 *
 * `done` is the only state that expires: the desktop lights a green dot
 * for ten seconds after a turn finishes and then drops it. Mobile cannot
 * share that timer, so it reads the transition stamp and decides for
 * itself. A `done` with no stamp stays lit rather than guessing, which is
 * what a tree loaded from disk before the first sync looks like.
 */
export function tabGlyph(
  agentState: string | undefined,
  agentStateAt: number | undefined,
  now: number,
): TabGlyph {
  if (agentState === 'awaiting') return 'awaiting'
  if (agentState === 'running') return 'running'
  if (agentState === 'error') return 'error'
  if (agentState !== 'done') return 'idle'
  if (agentStateAt === undefined) return 'done'
  return now - agentStateAt < DONE_LINGER_MS ? 'done' : 'idle'
}

/** Dot colour per glyph. `idle` is deliberately low contrast. */
export function glyphDotClass(glyph: TabGlyph): string {
  if (glyph === 'awaiting') return 'bg-warning'
  if (glyph === 'running' || glyph === 'done') return 'bg-success'
  if (glyph === 'error') return 'bg-destructive'
  return 'bg-muted-foreground/40'
}

/**
 * Whether the dot should pulse. Only a turn still in flight does, so the
 * animation means "something is happening" rather than decoration.
 */
export function glyphPulses(glyph: TabGlyph): boolean {
  return glyph === 'running'
}

/** One-word state for the accessibility label and the switcher rows. */
export function glyphLabel(glyph: TabGlyph): string {
  if (glyph === 'awaiting') return 'needs you'
  if (glyph === 'running') return 'running'
  if (glyph === 'done') return 'done'
  if (glyph === 'error') return 'failed'
  return 'idle'
}

/**
 * When a lit `done` dot should go out, or null when nothing is waiting to
 * expire. The caller arms one timer off this rather than polling a clock.
 */
export function doneExpiresAt(
  agentState: string | undefined,
  agentStateAt: number | undefined,
): number | null {
  if (agentState !== 'done' || agentStateAt === undefined) return null
  return agentStateAt + DONE_LINGER_MS
}
