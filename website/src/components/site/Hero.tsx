import Image from "next/image";
import Link from "next/link";
import { AppleLogo, DownloadSimple } from "@phosphor-icons/react/dist/ssr";
import HeroOscTitle from "./HeroOscTitle";
import InstallCommand from "./InstallCommand";

const DMG_ARM =
  "https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-aarch64.dmg";
const DMG_X64 =
  "https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-x64.dmg";

export default function Hero() {
  return (
    <section
      id="hero"
      className="relative w-full pt-28 pb-24 md:pt-32 md:pb-28"
    >
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 items-center gap-14 px-4 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7">
          <div className="mb-6 inline-flex w-fit items-center gap-2 rounded border border-border/70 bg-surface/60 px-2 py-1 font-mono text-[11px] text-text-faint">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-state-ok" />
            <span>running</span>
            <span className="text-text-faint/60">·</span>
            <span>macOS 12+</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-medium tracking-tight leading-[1.05] text-text-primary">
            Your Agents deserve
            <br />a better home.
          </h1>

          <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-text-muted">
            Agent Terminal groups every Claude Code, Codex, and OpenCode
            session by project. It reads what your agents are actually doing,
            then puts that on the status bar so you never have to ask.
          </p>

          <div className="mt-9 flex flex-col gap-3 max-w-[560px]">
            <InstallCommand />
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <Link
                href={DMG_ARM}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 font-mono text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
              >
                <AppleLogo size={14} weight="fill" />
                <span>Apple Silicon .dmg</span>
              </Link>
              <Link
                href={DMG_X64}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 font-mono text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
              >
                <DownloadSimple size={14} weight="regular" />
                <span>Intel .dmg</span>
              </Link>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="relative">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <HeroOscTitle />
              <span className="font-mono text-[11px] text-text-faint">
                ⏱ 4m 32s
              </span>
            </div>
            <div className="relative overflow-hidden rounded-lg border border-border shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6),0_0_0_1px_rgba(233,184,86,0.06)] lg:rotate-[2deg] lg:origin-left">
              <Image
                src="/screenshots/desktop-hero.png"
                alt="Agent Terminal running on macOS, showing the project sidebar, tab bar with agent badges, and status bar"
                width={1600}
                height={1000}
                priority
                className="h-auto w-full"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-lg shadow-[inset_0_1px_0_rgba(233,184,86,0.10)]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
