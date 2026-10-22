/**
 * The one state vocabulary both apps speak.
 *
 * `WireTabState` is deliberately the shape the protocol already carries
 * (`TabSummary.agent_state`) rather than a richer type the desktop would
 * have to be translated out of. The companion has nothing else, so a
 * shared derivation that needed more could only ever run on one side.
 *
 * It loses nothing. The desktop collapses into it with
 * `resolveSyncAgentState`, and every collapsed value maps back to exactly
 * one glyph state: `running` is a turn in flight, `done` and `error` are
 * both a finished turn, `awaiting` is a question on screen.
 */
export type WireTabState = 'idle' | 'running' | 'done' | 'error' | 'awaiting'

/** How long a finished shell command keeps its green dot. */
export const DONE_LINGER_MS = 10_000

/** Badge drawn over an agent's brand mark. */
export type AgentGlyphState = 'idle' | 'in-progress' | 'completed' | 'awaiting'

/** The dot drawn for a plain shell tab, which has no brand mark. */
export type ShellDot = 'running' | 'done' | 'error' | 'idle'

/** Brand colours for one agent. Fixed values: these are brand marks, not theme. */
export interface AgentBrand {
  /** Mark tint. */
  color: string
  /** Halo behind a mark whose turn is in flight. */
  glow: string
  /** Human-readable name, for accessibility labels and detail rows. */
  displayName: string
  /**
   * Command-line flags that hand the agent full permissions.
   *
   * Per-agent rather than one global list so adding an agent is one entry
   * rather than an edit to a shared regex somewhere else. Empty means the
   * agent has no such flag, not that it was forgotten.
   */
  fullPermissionFlags: readonly string[]
}

/**
 * One brand mark, reduced to geometry.
 *
 * Every primitive is a path `d` string, including shapes authored as
 * `<rect>` or `<polygon>`, so a renderer needs one element type and not
 * five. The conversion is mechanical and preserves winding, which the
 * non-zero fill rule depends on to cut holes.
 */
export interface AgentMark {
  viewBox: string
  /** Omitted where the default non-zero rule is what the artwork wants. */
  fillRule?: 'evenodd' | 'nonzero'
  paths: readonly string[]
}

/**
 * How to draw one agent's mark: its colours and its geometry.
 *
 * One field rather than two, because they are looked up from the same
 * id and are therefore always both present or both absent. Two nullable
 * fields invited every renderer to check both and left open a state
 * ("branded but no geometry") that cannot happen.
 */
export interface AgentArt {
  brand: AgentBrand
  mark: AgentMark
}

/**
 * Everything both apps need to draw one session's icon, and nothing
 * either of them has to work out for itself.
 */
export type TabVisual =
  | {
      kind: 'shell'
      dot: ShellDot
      pulses: boolean
      showDanger: false
      /** One word for the accessibility label and the detail sheet. */
      label: string
    }
  | {
      kind: 'agent'
      agentId: string
      /** Null for an agent this build has no artwork for. */
      art: AgentArt | null
      state: AgentGlyphState
      pulses: boolean
      /** True when the mark should render dim, which idle marks do unless selected. */
      dimmed: boolean
      showDanger: boolean
      label: string
    }

/** What `deriveTabVisual` needs. Both apps can produce all of it. */
export interface TabVisualInput {
  /** Registry id, or absent for a plain shell. */
  agentId?: string | undefined
  state: WireTabState
  /** Epoch ms of the last transition, which is what the done linger counts from. */
  stateAt?: number | undefined
  fullPermissions?: boolean | undefined
  /** True when this is the session on screen, which un-dims an idle mark. */
  active?: boolean | undefined
}
