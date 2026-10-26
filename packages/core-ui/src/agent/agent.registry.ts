import type { AgentBrand } from './agent.types'

/**
 * Per-agent brand data, keyed by the id the Rust agent registry assigns
 * (`agents::AgentProfile.id`). The same keys travel on the wire as
 * `TabSummary.agent_id`, so desktop, Rust and mobile all name agents
 * identically and a lookup that misses means a genuinely unknown agent
 * rather than a spelling difference.
 *
 * Colours are brand colours, so they are fixed rather than themed. The
 * state colours around them are not; those live in `STATE_COLORS`.
 */
export const AGENT_BRANDS: Record<string, AgentBrand> = {
  'claude-code': {
    color: '#D97757',
    glow: 'rgba(217,119,87,0.55)',
    displayName: 'Claude Code',
    fullPermissionFlags: ['--dangerously-skip-permissions'],
  },
  codex: {
    color: '#e6e8eb',
    glow: 'rgba(230,232,235,0.45)',
    displayName: 'Codex CLI',
    fullPermissionFlags: ['--yolo'],
  },
  opencode: {
    color: '#ebe9e6',
    glow: 'rgba(235,233,230,0.45)',
    displayName: 'opencode',
    fullPermissionFlags: [],
  },
  kilo: {
    color: '#cddc39',
    glow: 'rgba(205,220,57,0.45)',
    displayName: 'Kilo Code',
    fullPermissionFlags: [],
  },
  kimi: {
    color: '#027aff',
    glow: 'rgba(2,122,255,0.5)',
    displayName: 'Kimi CLI',
    fullPermissionFlags: [],
  },
  amp: {
    color: '#f34e3f',
    glow: 'rgba(243,78,63,0.5)',
    displayName: 'Amp',
    fullPermissionFlags: [],
  },
  mastracode: {
    color: '#e6e8eb',
    glow: 'rgba(230,232,235,0.45)',
    displayName: 'Mastra',
    fullPermissionFlags: [],
  },
}

/**
 * Colours for the state badges, by intent rather than by hex.
 *
 * The two apps already agreed on most of these by accident: the
 * desktop's `--running-dot` and the companion's `--success` hold the
 * same two values, and both call the awaiting amber `#e0af68`. Naming
 * the intents here turns that coincidence into something a change has to
 * go through.
 */
export const STATE_COLORS = {
  light: {
    running: '#2e8b3d',
    awaiting: '#b26a00',
    error: '#c23648',
  },
  dark: {
    running: '#9ece6a',
    awaiting: '#e0af68',
    error: '#f7768e',
  },
} as const

/**
 * Every flag that hands any agent full permissions.
 *
 * Flattened across agents rather than checked per agent, because a tab's
 * command is matched before its agent id is necessarily known, and a
 * `--yolo` in a claude command means the same dangerous thing whichever
 * registry entry declared it.
 */
export const FULL_PERMISSION_FLAGS: readonly string[] = Object.values(
  AGENT_BRANDS,
).flatMap((brand) => brand.fullPermissionFlags)
