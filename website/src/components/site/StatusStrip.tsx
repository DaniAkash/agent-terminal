"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";

/*
 * The signature idea for the page. A slim mono strip fixed to the top
 * of the viewport that mimics agent-terminal's own status bar. Section
 * pill on the left updates as the user scrolls (IntersectionObserver);
 * right group runs a real session timer so the whole thing feels alive.
 *
 * The IntersectionObserver keeps a per-section visibility set (not just
 * the current-callback delta) so the "active" section is always the
 * topmost intersecting one from the full SECTIONS list, no matter which
 * subset of sections happened to change intersection state in the last
 * callback batch. This is the correction to the previous version that
 * skipped labels when 4 consecutive sections all intersected the
 * viewport at the same scroll position without a change event firing.
 */

const SECTIONS = [
  { id: "hero", label: "hero" },
  { id: "social", label: "signals" },
  { id: "problem", label: "problem" },
  { id: "solution", label: "solution" },
  { id: "features", label: "features / mod-engine" },
  { id: "agent-state", label: "features / agent-state" },
  { id: "status-bar", label: "features / status-bar" },
  { id: "keymap", label: "features / keymap" },
  { id: "companion", label: "companion" },
  { id: "how", label: "how-it-works" },
  { id: "faq", label: "faq" },
  { id: "cta", label: "cta" },
];

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export default function StatusStrip() {
  const [active, setActive] = useState<string>("hero");
  const [elapsedMs, setElapsedMs] = useState(0);
  const visibleRef = useRef<Set<string>>(new Set(["hero"]));

  const orderedIds = useMemo(() => SECTIONS.map((s) => s.id), []);

  // Update the section pill as the user scrolls. Track full visible
  // set across callbacks, then compute the topmost intersecting section
  // from the ordered SECTIONS list.
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visibleRef.current.add(e.target.id);
          else visibleRef.current.delete(e.target.id);
        }
        // Topmost intersecting section = first id in the ordered list
        // that's currently visible. Falls back to the last known section
        // (never regresses to "hero" mid-page).
        const topmost = orderedIds.find((id) => visibleRef.current.has(id));
        if (topmost) setActive(topmost);
      },
      // Trigger when a section's top crosses the header + 15% mark.
      // Bottom margin -70% so a section only "counts" once it's in
      // roughly the top third of the viewport, which matches where a
      // reader's eye actually is.
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [orderedIds]);

  // Live "session" timer since page load.
  useEffect(() => {
    const started = performance.now();
    const id = setInterval(() => {
      setElapsedMs(performance.now() - started);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const activeLabel =
    SECTIONS.find((s) => s.id === active)?.label ?? "hero";

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 z-50 h-8 border-b border-border/80 bg-bg/70 backdrop-blur-md"
    >
      <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between px-4 font-mono text-[11px] text-text-faint">
        <div className="flex items-center gap-3">
          <span className="text-text-muted">agent-terminal</span>
          <span className="text-text-faint">/</span>
          <motion.span
            key={activeLabel}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            className="text-accent"
          >
            {activeLabel}
          </motion.span>
        </div>
        <div className="hidden items-center gap-4 sm:flex">
          <span>
            <span className="text-text-faint">⏱ </span>
            <span className="text-text-muted">{formatElapsed(elapsedMs)}</span>
          </span>
          <span className="hidden md:inline">
            <span className="text-text-faint">🧮 </span>
            <span className="text-text-muted">1.2 GB</span>
          </span>
          <span>
            <span className="text-text-faint">main </span>
            <span className="text-text-muted">↑v0.1.5</span>
          </span>
        </div>
      </div>
    </div>
  );
}
