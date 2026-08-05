"use client";

import { useState } from "react";
import { Check, Copy } from "@phosphor-icons/react/dist/ssr";

interface Props {
  command?: string;
  className?: string;
}

export default function InstallCommand({
  command = "brew tap daniakash/tap && brew install --cask agent-terminal",
  className = "",
}: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail silently in some browsers or contexts;
      // the command is still visually selectable in the code block.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`group flex w-full items-center justify-between gap-3 rounded-md border border-border-strong bg-surface px-4 py-3 text-left transition-all active:translate-y-[1px] active:scale-[0.995] hover:border-accent/50 ${className}`}
    >
      <code className="truncate font-mono text-[13px] text-text-primary sm:text-[14px]">
        <span className="mr-2 text-accent">$</span>
        {command}
      </code>
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-text-muted group-hover:text-accent transition-colors">
        {copied ? (
          <>
            <Check size={13} weight="bold" /> copied
          </>
        ) : (
          <>
            <Copy size={13} weight="regular" /> copy
          </>
        )}
      </span>
    </button>
  );
}
