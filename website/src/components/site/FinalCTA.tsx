import Link from "next/link";
import {
  ArrowSquareOut,
  Bug,
  Star,
} from "@phosphor-icons/react/dist/ssr";
import InstallCommand from "./InstallCommand";

export default function FinalCTA() {
  return (
    <section
      id="cta"
      className="w-full py-32 md:py-44 border-t border-border/40"
    >
      <div className="mx-auto max-w-[720px] px-4 text-center">
        <h2 className="text-4xl md:text-6xl font-medium tracking-tight leading-[1.05] text-text-primary">
          Give your agents a better home.
        </h2>
        <p className="mx-auto mt-6 max-w-[52ch] text-[17px] leading-relaxed text-text-muted">
          Install once, pair your phone if you want, and stop guessing which
          shell is doing what.
        </p>

        <div className="mx-auto mt-10 max-w-[560px]">
          <InstallCommand />
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[13px]">
          <Link
            href="https://github.com/DaniAkash/agent-terminal"
            className="inline-flex items-center gap-2 text-text-muted hover:text-text-primary transition-colors"
          >
            <Star size={14} weight="regular" />
            Star on GitHub
          </Link>
          <Link
            href="https://github.com/DaniAkash/agent-terminal/issues/new"
            className="inline-flex items-center gap-2 text-text-muted hover:text-text-primary transition-colors"
          >
            <Bug size={14} weight="regular" />
            File an issue
          </Link>
          <Link
            href="https://x.com/dani_akash_"
            className="inline-flex items-center gap-2 text-text-muted hover:text-text-primary transition-colors"
          >
            <ArrowSquareOut size={14} weight="regular" />
            Follow on X
          </Link>
        </div>
      </div>
    </section>
  );
}
