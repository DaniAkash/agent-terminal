import {
  Certificate,
  HouseSimple,
  ProhibitInset,
  ShieldCheck,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";

const PILLS = [
  { icon: Sparkle, label: "Featured on Product Hunt" },
  { icon: Certificate, label: "MIT-licensed" },
  { icon: ShieldCheck, label: "Signed + notarized · macOS 12+" },
  { icon: HouseSimple, label: "100% local · no telemetry" },
  { icon: ProhibitInset, label: "Pre-alpha", accent: true },
];

export default function SocialProof() {
  return (
    <section className="border-y border-border/70 bg-surface/40 py-5">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 sm:px-8 lg:px-12">
        {PILLS.map((pill, i) => {
          const Icon = pill.icon;
          return (
            <div
              key={i}
              className={`inline-flex items-center gap-2 font-mono text-[11px] ${
                pill.accent ? "text-accent" : "text-text-muted"
              }`}
            >
              <Icon
                size={13}
                weight="regular"
                className={pill.accent ? "text-accent" : "text-text-faint"}
              />
              <span>{pill.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
