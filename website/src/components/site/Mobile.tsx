import { QrCode, ShieldCheck } from "@phosphor-icons/react/dist/ssr";

const USE_CASES = [
  {
    tag: "from the couch,",
    body: "Kick off `bun run build` or `pytest --slow` on your Mac, close the lid, and check on it from bed. When it finishes, your phone buzzes and shows you the exit code.",
  },
  {
    tag: "from the coffee shop,",
    body: "SSH, tail logs, rerun a failed deploy, all from the phone that is already in your hand. Your work laptop can stay at home.",
  },
  {
    tag: "from the meeting room,",
    body: "Claude Code stops for a permission prompt. Your Mac is in another room. The prompt is on your phone. You approve. The agent keeps going.",
  },
];

export default function Mobile() {
  return (
    <section
      id="companion"
      className="w-full bg-surface/60 py-28 md:py-40 border-y border-border/50"
    >
      <div className="mx-auto max-w-[1400px] px-4">
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5 flex flex-col justify-center">
            <div className="mb-4 inline-flex w-fit items-center gap-2 rounded border border-border/70 bg-bg/60 px-2 py-1 font-mono text-[11px] text-text-faint">
              <span>[proc: agent-terminal-companion]</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-medium tracking-tight leading-[1.1] text-text-primary">
              Your terminal,
              <br />
              in your pocket.
            </h2>
            <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-text-muted">
              A native iOS and Android app that pairs with your Mac over your
              local network. Not a preview. Not a status page. Every project,
              every tab, every keystroke, live.
            </p>

            <div className="mt-10 space-y-5">
              {USE_CASES.map((c, i) => (
                <div
                  key={i}
                  className="border-l-2 border-accent/60 pl-4 max-w-[52ch]"
                >
                  <div className="font-mono text-[12px] text-accent">
                    {c.tag}
                  </div>
                  <div className="mt-1 text-[15px] leading-relaxed text-text-muted">
                    {c.body}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 rounded-lg border border-border-strong bg-bg/60 p-5 max-w-[560px]">
              <div className="flex items-start gap-3">
                <ShieldCheck
                  size={18}
                  weight="regular"
                  className="mt-0.5 shrink-0 text-accent"
                />
                <div>
                  <div className="font-medium text-[15px] text-text-primary">
                    Nothing leaves your network.
                  </div>
                  <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
                    Pairing is QR-scan-once with a fingerprint you can visually
                    verify. All traffic runs over TLS with an automated pin
                    check. Revoke a device from the desktop and it disconnects
                    in seconds.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 flex flex-col justify-center">
            <div className="relative mx-auto grid w-full max-w-[560px] grid-cols-3 gap-3">
              {["projects", "terminal", "pairing"].map((s, i) => (
                <div
                  key={s}
                  className="relative aspect-[9/19] rounded-2xl border border-border bg-bg overflow-hidden"
                >
                  <div className="absolute inset-x-0 top-0 h-6 border-b border-border/70 bg-surface" />
                  <div className="absolute inset-x-3 top-9 bottom-3 flex flex-col gap-2">
                    {i === 0 && <PhoneProjects />}
                    {i === 1 && <PhoneTerminal />}
                    {i === 2 && <PhonePairing />}
                  </div>
                </div>
              ))}
            </div>
            <div className="mx-auto mt-4 max-w-[560px] font-mono text-[11px] text-text-faint text-center">
              iOS + Android · Expo dev client · TLS + pinned websocket
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PhoneProjects() {
  const tabs = [
    { label: "dev", spawned: true },
    { label: "test", spawned: true },
    { label: "logs", spawned: false },
    { label: "shell", spawned: false },
  ];
  return (
    <>
      <div className="font-mono text-[9px] uppercase tracking-widest text-text-faint">
        Projects
      </div>
      <div className="mt-1 rounded border border-border/60 bg-surface/60 p-2">
        <div className="text-[10px] font-medium text-text-primary">my-app</div>
        <div className="mt-1.5 space-y-1">
          {tabs.map((t) => (
            <div
              key={t.label}
              className={`rounded border-l-2 px-1.5 py-1 text-[9px] ${
                t.spawned
                  ? "border-accent bg-accent-tint text-text-primary"
                  : "border-transparent bg-bg/60 text-text-faint"
              }`}
            >
              {t.label}
              {!t.spawned && (
                <span className="ml-1 text-[8px] uppercase text-text-faint">
                  · sleeping
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function PhoneTerminal() {
  return (
    <>
      <div className="font-mono text-[9px] uppercase tracking-widest text-text-faint">
        my-app / dev
      </div>
      <div className="mt-1 flex-1 rounded border border-border/60 bg-bg/80 p-2 font-mono text-[8.5px] leading-relaxed text-text-primary">
        <div className="text-text-faint">$ pytest</div>
        <div className="text-text-muted">collecting ... </div>
        <div className="text-state-ok">
          test_login PASS
        </div>
        <div className="text-state-ok">
          test_signup PASS
        </div>
        <div className="text-text-muted">test_reset ... </div>
        <div className="mt-1.5 inline-block h-1.5 w-1 animate-pulse bg-accent" />
      </div>
    </>
  );
}

function PhonePairing() {
  return (
    <>
      <div className="font-mono text-[9px] uppercase tracking-widest text-text-faint">
        Pair
      </div>
      <div className="mt-1 flex flex-1 flex-col items-center justify-center gap-2 rounded border border-border/60 bg-surface/60 p-2">
        <QrCode size={40} weight="regular" className="text-text-primary" />
        <div className="font-mono text-[8px] text-text-faint">
          fingerprint
        </div>
        <div className="font-mono text-[7.5px] text-accent">
          A4:B2:F3:D1:...
        </div>
      </div>
    </>
  );
}
