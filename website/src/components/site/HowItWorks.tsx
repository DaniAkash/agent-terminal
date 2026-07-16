import {
  DownloadSimple,
  FolderOpen,
  QrCode,
} from "@phosphor-icons/react/dist/ssr";

const STEPS = [
  {
    icon: DownloadSimple,
    title: "Install",
    body: "One brew command or a DMG. Signed and notarized so macOS lets it launch without warnings.",
    detail: "brew install --cask daniakash/tap/agent-terminal",
  },
  {
    icon: FolderOpen,
    title: "Group your tabs",
    body: "Create a project for each workspace you live in. Open the tabs you need. They remember their cwd, so a restart drops you back where you were.",
    detail: null,
  },
  {
    icon: QrCode,
    title: "Pair your phone",
    body: "Optional. Open the Companion dialog on your Mac. Scan the QR from the Agent Terminal Companion on your phone. That is the whole setup.",
    detail: null,
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how"
      className="w-full py-28 md:py-36 border-t border-border/40"
    >
      <div className="mx-auto max-w-[1400px] px-4">
        <div className="mx-auto mb-16 max-w-[640px] text-center">
          <h2 className="text-3xl md:text-5xl font-medium tracking-tight leading-[1.1] text-text-primary">
            Three steps.
          </h2>
          <p className="mt-5 text-[16px] text-text-muted">
            The third one is optional but you will want it.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={s.title} className="flex flex-col">
                <div className="mb-6 flex items-center gap-4">
                  <span className="font-mono text-[13px] text-text-faint">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                  <Icon size={20} weight="regular" className="text-accent" />
                </div>
                <h3 className="text-xl font-medium tracking-tight text-text-primary">
                  {s.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-text-muted">
                  {s.body}
                </p>
                {s.detail && (
                  <div className="mt-4 rounded-md border border-border bg-surface px-3 py-2 font-mono text-[12px] text-text-muted">
                    <span className="text-accent">$ </span>
                    {s.detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
