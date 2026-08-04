"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  BellSimple,
  Check,
  CircleNotch,
} from "@phosphor-icons/react/dist/ssr";

const STATES = [
  {
    id: "working",
    label: "working",
    icon: CircleNotch,
    accent: "border-accent bg-accent-tint text-accent",
    dot: "bg-accent",
  },
  {
    id: "awaiting",
    label: "awaiting input",
    icon: BellSimple,
    accent: "border-state-danger/60 bg-state-danger/10 text-state-danger",
    dot: "bg-state-danger",
  },
  {
    id: "done",
    label: "done",
    icon: Check,
    accent: "border-state-ok/60 bg-state-ok/10 text-state-ok",
    dot: "bg-state-ok",
  },
];

export default function AgentState() {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((n) => (n + 1) % STATES.length), 2400);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <section
      id="agent-state"
      className="w-full py-28 md:py-36 border-t border-border/40"
    >
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-14 px-6 sm:px-8 lg:px-12 lg:grid-cols-12">
        <div className="lg:col-span-6 order-2 lg:order-1">
          <div className="rounded-lg border border-border bg-surface p-8">
            <div className="mb-6 font-mono text-[11px] text-text-faint">
              claude-code · state
            </div>
            <div className="grid grid-cols-3 gap-3">
              {STATES.map((s, idx) => {
                const isActive = reduce ? true : idx === i;
                const Icon = s.icon;
                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border p-4 transition-all duration-300 ${
                      isActive
                        ? s.accent
                        : "border-border/60 bg-bg/40 text-text-faint"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Icon
                        size={16}
                        weight={isActive ? "fill" : "regular"}
                        className={
                          isActive && s.id === "working" && !reduce
                            ? "animate-spin [animation-duration:2s]"
                            : ""
                        }
                      />
                      {isActive && !reduce && (
                        <motion.span
                          layoutId="active-dot"
                          className={`h-1.5 w-1.5 rounded-full ${s.dot}`}
                        />
                      )}
                    </div>
                    <div className="mt-3 font-mono text-[12px]">{s.label}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 flex items-center gap-2 border-t border-border pt-4 font-mono text-[11px] text-text-faint">
              <span>listening on hook :47384</span>
              <span className="text-text-faint/50">·</span>
              <span>osc parser attached</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 order-1 lg:order-2 flex flex-col justify-center">
          <h3 className="text-3xl md:text-4xl font-medium tracking-tight leading-[1.15] text-text-primary">
            Know when your agent
            <br />
            is waiting on you.
          </h3>
          <div className="mt-6 space-y-4 max-w-[52ch] text-[16px] leading-relaxed text-text-muted">
            <p>
              Every agent tab shows a live state, working, awaiting, or done,
              computed from hook events, OSC titles, and process activity.
            </p>
            <p>
              If your agent hits a permission prompt while your other terminals
              scroll past, you get an OS notification. Tap it to focus that
              exact tab. Your phone gets the same signal.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
