export function RunningDot() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
      <span className="bg-running-dot absolute inset-0 animate-[pulse-ring_1.6s_ease-out_infinite] rounded-full opacity-30" />
      <span className="bg-running-dot absolute inset-[1px] rounded-full" />
    </span>
  )
}
