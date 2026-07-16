const QUESTIONS = [
  {
    q: "Is this a fork of iTerm2, Warp, Ghostty, or Wezterm?",
    a: "No. It is built ground-up on Tauri, Rust, and xterm.js. Warp, Ghostty, and Wezterm are terminals with AI features bolted on top. Agent Terminal is a terminal built around the fact that agents are living in it.",
  },
  {
    q: "Does it work on Linux or Windows?",
    a: "Pre-alpha macOS only right now. Both platforms are on the roadmap, the underlying stack supports them, and the biggest thing missing is people to test the port. If you are interested, open an issue.",
  },
  {
    q: "Is my data safe?",
    a: "Nothing leaves your machine or your network. There is no cloud. The mobile companion connects over your local Wi-Fi via TLS with per-device tokens minted at pair time. Revoking a device from the desktop cuts its connection.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. MIT-licensed. Signed and notarized so macOS Gatekeeper is happy. If you build something on it, keep the copyright notice.",
  },
  {
    q: "Which agents work today?",
    a: "Claude Code, Codex, and OpenCode ship with first-class detection and state tracking. Adding a new agent is one entry in a registry, so if you use something else, the fastest path is a small PR (or an issue and it gets picked up).",
  },
  {
    q: "Is it production-ready?",
    a: "It is honest pre-alpha. Daily-driven on macOS and zsh; other shells and platforms are lightly tested. Things will change. Bugs will show up. Feature requests are welcome.",
  },
];

export default function FAQ() {
  return (
    <section
      id="faq"
      className="w-full py-28 md:py-36 border-t border-border/40"
    >
      <div className="mx-auto max-w-3xl px-6 sm:px-8 lg:px-12">
        <h2 className="text-3xl md:text-4xl font-medium tracking-tight leading-[1.15] text-text-primary">
          Common questions.
        </h2>
        <div className="mt-12">
          {QUESTIONS.map((item, i) => (
            <div
              key={i}
              className="grid grid-cols-1 gap-4 border-t border-border/70 py-8 md:grid-cols-[220px_1fr] md:gap-10"
            >
              <h3 className="font-medium text-[16px] leading-snug text-text-primary">
                {item.q}
              </h3>
              <p className="text-[15px] leading-relaxed text-text-muted">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
