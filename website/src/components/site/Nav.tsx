import Image from "next/image";
import Link from "next/link";
import { GithubLogo, Star } from "@phosphor-icons/react/dist/ssr";

export default function Nav() {
  return (
    <header className="fixed top-8 left-0 right-0 z-40 h-16 border-b border-border/60 bg-bg/70 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between px-6 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt=""
            width={32}
            height={32}
            className="rounded"
            priority
          />
          <span className="font-medium text-[15px] tracking-tight text-text-primary">
            agent-terminal
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3">
          <Link
            href="https://github.com/DaniAkash/agent-terminal"
            className="hidden sm:inline text-[13px] text-text-muted hover:text-text-primary transition-colors"
          >
            source
          </Link>
          <Link
            href="https://github.com/DaniAkash/agent-terminal/releases"
            className="hidden sm:inline text-[13px] text-text-muted hover:text-text-primary transition-colors"
          >
            releases
          </Link>
          <Link
            href="https://github.com/DaniAkash/agent-terminal"
            className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] font-mono text-text-muted hover:border-border-strong hover:text-text-primary transition-colors"
          >
            <GithubLogo size={14} weight="regular" />
            <span className="hidden xs:inline">github</span>
            <Star size={12} weight="fill" className="text-accent" />
          </Link>
        </nav>
      </div>
    </header>
  );
}
