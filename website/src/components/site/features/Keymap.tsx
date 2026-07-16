import { Command } from "@phosphor-icons/react/dist/ssr";

const KEYS = [
  { chord: "⌘T", action: "new tab in the active project" },
  { chord: "⌘W", action: "close the active tab (pinned protected)" },
  { chord: "⌘⇧]", action: "next tab" },
  { chord: "⌘⇧[", action: "previous tab" },
  { chord: "⌘P", action: "quick-switch across every tab, sorted by recency" },
  { chord: "⌘1 … ⌘9", action: "jump to project N, pinned first" },
  { chord: "⌘=", action: "font zoom in" },
  { chord: "⌘-", action: "font zoom out" },
  { chord: "⌘0", action: "reset font zoom" },
  { chord: "⌘K", action: "clear terminal + scrollback" },
  { chord: "⌘F", action: "search inside the tab" },
  { chord: "⇧↵", action: "insert newline in Claude Code and Codex prompts" },
];

export default function Keymap() {
  return (
    <section
      id="keymap"
      className="w-full py-28 md:py-36 border-t border-border/40"
    >
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-14 px-4 lg:grid-cols-12">
        <div className="lg:col-span-6 flex flex-col justify-center">
          <h3 className="text-3xl md:text-4xl font-medium tracking-tight leading-[1.15] text-text-primary">
            Terminal muscle memory.
            <br />
            Not mouse memory.
          </h3>
          <div className="mt-6 space-y-4 max-w-[52ch] text-[16px] leading-relaxed text-text-muted">
            <p>
              Every navigation flow ships as a keybinding, project jumping,
              tab cycling, quick-switching, font zoom, clear. Font zoom
              matches by produced character, so it works on non-US layouts
              too.
            </p>
            <p>
              Muscle memory from iTerm2, Warp, or Ghostty carries over. What
              is new is grouped tabs and the agent-state signals wired into
              those same keys.
            </p>
          </div>
        </div>
        <div className="lg:col-span-6">
          <div className="rounded-lg border border-border bg-surface p-6">
            <div className="mb-4 flex items-center gap-2 font-mono text-[11px] text-text-faint">
              <Command size={13} />
              <span>selected keybindings</span>
            </div>
            <div className="grid gap-2">
              {KEYS.map((k) => (
                <div
                  key={k.chord}
                  className="grid grid-cols-[100px_1fr] items-baseline gap-4 py-1.5"
                >
                  <span className="font-mono text-[13px] text-accent">
                    {k.chord}
                  </span>
                  <span className="text-[14px] text-text-muted">
                    {k.action}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
