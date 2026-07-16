import { codeToHtml } from "shiki";

const SNIPPET = `pub const AGENTS: &[AgentProfile] = &[
    AgentProfile {
        id: "claude-code",
        display: "Claude Code",
        process_names: &["claude"],
        hook_events: &[SessionStart, PromptSubmit, ToolCall, ToolResult],
        osc_signatures: OscSignatures {
            working: "braille-prefix",
            awaiting: "action-required",
        },
    },
    AgentProfile {
        id: "codex",
        display: "Codex",
        process_names: &["codex"],
        hook_events: &[SessionStart, TurnStart, TurnEnd],
        osc_signatures: OscSignatures {
            working: "braille-frames",
            awaiting: "action-required",
        },
    },
    AgentProfile {
        id: "opencode",
        display: "OpenCode",
        process_names: &["opencode"],
        hook_events: &[ChatMessage, SessionStatus, PermissionRequest],
        osc_signatures: OscSignatures::NONE,
    },
];`;

export default async function ModEngine() {
  const html = await codeToHtml(SNIPPET, {
    lang: "rust",
    theme: "github-dark-dimmed",
  });

  return (
    <section
      id="features"
      className="w-full py-28 md:py-36 border-t border-border/40"
    >
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-14 px-6 sm:px-8 lg:px-12 lg:grid-cols-12">
        <div className="lg:col-span-5 flex flex-col justify-center">
          <div className="mb-4 inline-flex w-fit items-center gap-2 rounded border border-border/70 bg-surface/60 px-2 py-1 font-mono text-[11px] text-text-faint">
            <span>[proc: mod-engine]</span>
          </div>
          <h3 className="text-3xl md:text-4xl font-medium tracking-tight leading-[1.15] text-text-primary">
            Agents are just plugins.
            <br />
            Yours can be too.
          </h3>
          <div className="mt-6 space-y-4 max-w-[52ch] text-[16px] leading-relaxed text-text-muted">
            <p>
              Every capability, git polling, port scanning, agent-state fusion,
              is a MOD that watches terminal output and emits events. Claude
              Code, Codex, and OpenCode ship as MODs today.
            </p>
            <p>
              Adding a fourth agent is one registry entry. If it emits OSC
              titles or ships a plugin API, we can read it.
            </p>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2 font-mono text-[11px] text-text-faint">
              <span>agent_registry.rs</span>
              <span>rust</span>
            </div>
            <div
              className="text-[13px] leading-relaxed overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
