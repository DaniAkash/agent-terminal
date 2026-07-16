"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const STATES = [
  { id: "working", label: "working", tone: "text-accent" },
  { id: "awaiting", label: "awaiting", tone: "text-state-danger" },
  { id: "done", label: "done", tone: "text-state-ok" },
];

export default function HeroOscTitle() {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((n) => (n + 1) % STATES.length), 2200);
    return () => clearInterval(id);
  }, [reduce]);

  const current = STATES[i];

  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[11px] text-text-muted">
      <span className="text-text-faint">title:</span>
      <span>my-app / claude-code</span>
      <span className="text-text-faint">·</span>
      {reduce ? (
        <span className={`${current.tone}`}>{current.label}</span>
      ) : (
        <AnimatePresence mode="wait">
          <motion.span
            key={current.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.28 }}
            className={current.tone}
          >
            {current.label}
          </motion.span>
        </AnimatePresence>
      )}
    </div>
  );
}
