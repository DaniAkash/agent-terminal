export function RunningDot() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inset-0 animate-[pulse-ring_1.6s_ease-out_infinite] rounded-full bg-running-dot opacity-30" />
      <span className="absolute inset-[1px] rounded-full bg-running-dot" />
    </span>
  )
}
