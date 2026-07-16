import { CodeBlock, GitBranch, Sparkle } from "@phosphor-icons/react/dist/ssr";

/*
 * Tile C, centered dense (breaks the zigzag rhythm per the design plan).
 * Renders a "portrait" of the app's own status bar, then annotates it in
 * plain HTML so the annotations survive light/dark mode + a11y readers.
 */

const FIELDS = [
  { icon: GitBranch, label: "git branch", value: "main ↑2" },
  { icon: Sparkle, label: "model", value: "claude-opus-4" },
  { icon: CodeBlock, label: "cwd", value: "~/workspace/my-app" },
];

const METRICS = [
  { label: "process", value: "claude" },
  { label: "pid", value: "68541" },
  { label: "elapsed", value: "4m 32s" },
  { label: "memory", value: "1.2 GB" },
  { label: "ports", value: "3000, 5173" },
];

export default function StatusBarFeature() {
  return (
    <section className="w-full py-28 md:py-36 border-t border-border/40">
      <div className="mx-auto max-w-[1000px] px-4 text-center">
        <h3 className="text-3xl md:text-4xl font-medium tracking-tight leading-[1.15] text-text-primary">
          Everything you would normally run{" "}
          <code className="rounded bg-surface px-2 py-0.5 font-mono text-[0.85em] text-accent">
            ps
          </code>{" "}
          or{" "}
          <code className="rounded bg-surface px-2 py-0.5 font-mono text-[0.85em] text-accent">
            git status
          </code>{" "}
          to find.
        </h3>
        <p className="mx-auto mt-6 max-w-[60ch] text-[16px] leading-relaxed text-text-muted">
          Live process name, PID, memory, elapsed time, listening TCP ports,
          git branch, ahead/behind, PR status, working directory. Refreshed
          every couple of seconds. Adapts, PR checks poll faster while a check
          is pending, then slow down when they land.
        </p>

        <div className="mt-12 rounded-lg border border-border bg-surface overflow-hidden">
          <div className="border-b border-border px-4 py-2 font-mono text-[11px] text-text-faint text-left">
            focused tab: my-app / claude-code
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border bg-bg/40 px-4 py-3 font-mono text-[12px]">
            {FIELDS.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.label} className="flex items-center gap-2">
                  <Icon size={13} className="text-text-faint" />
                  <span className="text-text-primary">{f.value}</span>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 px-4 py-4 text-left sm:grid-cols-5">
            {METRICS.map((m) => (
              <div key={m.label} className="flex flex-col">
                <span className="font-mono text-[10.5px] uppercase tracking-widest text-text-faint">
                  {m.label}
                </span>
                <span className="mt-1 font-mono text-[13px] text-text-primary">
                  {m.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
