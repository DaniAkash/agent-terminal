import { Terminal } from "@phosphor-icons/react/dist/ssr";

export default function Problem() {
  return (
    <section
      id="problem"
      className="w-full py-28 md:py-36 border-b border-border/40"
    >
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-14 px-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <h2 className="text-3xl md:text-5xl font-medium tracking-tight leading-[1.1] text-text-primary">
            A normal terminal doesn&rsquo;t know
            <br />
            it&rsquo;s babysitting an AI.
          </h2>
          <div className="mt-8 space-y-5 text-lg leading-relaxed text-text-muted max-w-[65ch]">
            <p>
              Your terminal has always treated every process the same. But
              Claude Code isn&rsquo;t{" "}
              <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[15px] text-text-primary">
                grep
              </code>
              . Codex isn&rsquo;t{" "}
              <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[15px] text-text-primary">
                curl
              </code>
              . These are long-lived collaborators with their own state, their
              own permission prompts, and a habit of doing something
              interesting for six minutes and then quietly waiting for you.
            </p>
            <p>
              Regular terminals give you a tab labelled{" "}
              <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[15px] text-text-primary">
                zsh
              </code>
              . You get to figure out the rest. Which project? Which agent?
              Working, or waiting on you? What&rsquo;s it listening on? What
              branch? You end up with 14 tabs, a mental map of which is which,
              and you still tab through them one by one when a build finishes
              because the tab label didn&rsquo;t change.
            </p>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-widest text-text-faint">
                <Terminal size={13} weight="regular" />
                <span>Terminal.app</span>
              </div>
              <div className="space-y-1.5 font-mono text-[12px] text-text-muted">
                <div className="rounded border-l-2 border-transparent bg-bg/50 px-2 py-1.5">
                  zsh
                </div>
                <div className="rounded border-l-2 border-transparent bg-bg/50 px-2 py-1.5">
                  zsh
                </div>
                <div className="rounded border-l-2 border-transparent bg-bg/50 px-2 py-1.5">
                  zsh 2
                </div>
                <div className="rounded border-l-2 border-transparent bg-bg/50 px-2 py-1.5">
                  -bash
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border-strong bg-surface p-4">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-widest text-accent">
                <Terminal size={13} weight="regular" />
                <span>Agent Terminal</span>
              </div>
              <div className="space-y-1.5 font-mono text-[12px]">
                <div className="rounded border-l-2 border-accent bg-accent-tint px-2 py-1.5 text-text-primary">
                  <span className="text-text-faint">my-app / </span>dev
                </div>
                <div className="rounded border-l-2 border-state-ok/70 bg-bg/50 px-2 py-1.5 text-text-primary">
                  <span className="text-text-faint">notes / </span>claude
                </div>
                <div className="rounded border-l-2 border-state-danger/70 bg-bg/50 px-2 py-1.5 text-text-primary">
                  <span className="text-text-faint">infra / </span>codex
                </div>
                <div className="rounded border-l-2 border-transparent bg-bg/50 px-2 py-1.5 text-text-primary">
                  <span className="text-text-faint">infra / </span>logs
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
