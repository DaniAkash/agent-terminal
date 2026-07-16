"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";

/*
 * The signature idea for the page. A slim mono strip fixed to the top
 * of the viewport that mimics agent-terminal's own status bar. Section
 * pill on the left updates as the user scrolls (IntersectionObserver);
 * right group runs a fake session timer so the whole thing feels alive.
 *
 * Zero fake-precise data: the elapsed time is real (counts up from page
 * load), the memory value is a static plausible number (mock, allowed
 * because the label is not a claim about product performance), and the
 * git-style tag is real (the current release version).
 */

const SECTIONS = [
  { id: "hero", label: "hero" },
  { id: "problem", label: "problem" },
  { id: "solution", label: "solution" },
  { id: "features", label: "features / mod-engine" },
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

  // Update the section pill as the user scrolls.
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost intersecting section, matches how a real
        // status bar reports the "focused" tab.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActive(visible[0].target.id);
        }
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: [0, 0.1, 0.5] },
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Live "session" timer since page load. Real, not mock.
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
