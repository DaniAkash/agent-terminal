import Image from "next/image";
import Link from "next/link";

const COLS = [
  {
    heading: "Product",
    links: [
      {
        label: "Download",
        href: "https://github.com/DaniAkash/agent-terminal/releases/latest",
      },
      { label: "Homebrew tap", href: "https://github.com/DaniAkash/homebrew-tap" },
      {
        label: "Releases",
        href: "https://github.com/DaniAkash/agent-terminal/releases",
      },
      {
        label: "Roadmap",
        href: "https://github.com/DaniAkash/agent-terminal#roadmap",
      },
    ],
  },
  {
    heading: "Source",
    links: [
      { label: "GitHub", href: "https://github.com/DaniAkash/agent-terminal" },
      {
        label: "Contributing",
        href: "https://github.com/DaniAkash/agent-terminal/blob/main/CONTRIBUTING.md",
      },
      {
        label: "Issues",
        href: "https://github.com/DaniAkash/agent-terminal/issues",
      },
      { label: "License", href: "https://github.com/DaniAkash/agent-terminal/blob/main/LICENSE" },
    ],
  },
  {
    heading: "About",
    links: [
      { label: "Author", href: "https://github.com/DaniAkash" },
      { label: "Follow on X", href: "https://x.com/dani_akash_" },
      { label: "Privacy: no telemetry, no cloud", href: "#" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="w-full border-t border-border/60 bg-surface/40 py-16">
      <div className="mx-auto max-w-[1400px] px-6 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Image
                src="/logo.png"
                alt=""
                width={28}
                height={28}
                className="rounded"
              />
              <span className="font-medium text-[15px] text-text-primary">
                agent-terminal
              </span>
            </div>
            <p className="mt-4 max-w-[28ch] text-[13px] leading-relaxed text-text-muted">
              A terminal that knows the difference between a shell and an
              agent.
            </p>
            <div className="mt-6 font-mono text-[11px] text-text-faint">
              MIT · 2026 Dani Akash
            </div>
          </div>
          {COLS.map((col) => (
            <div key={col.heading}>
              <div className="font-mono text-[10.5px] uppercase tracking-widest text-text-faint">
                {col.heading}
              </div>
              <ul className="mt-5 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-[13px] text-text-muted hover:text-text-primary transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
