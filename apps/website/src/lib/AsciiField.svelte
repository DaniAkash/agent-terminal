<script lang="ts">
import { onMount } from 'svelte'

let canvas: HTMLCanvasElement
const ramp = ' .:-=+*#%@'
const cellSize = 14
const cursorRadius = 140
function noise(x: number, y: number, t: number) {
  return (
    (Math.sin(x * 1.7 + t * 0.6) +
      Math.sin(y * 2.3 - t * 0.4) +
      Math.sin((x + y) * 1.1 + t * 0.25) +
      Math.sin(Math.hypot(x - 6, y - 4) * 1.9 - t * 0.7)) /
      8 +
    0.5
  )
}
onMount(() => {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const pointer = { x: -10000, y: -10000, tx: -10000, ty: -10000 }
  let cols = 0,
    rows = 0,
    width = 0,
    height = 0,
    frame = 0,
    t = 0,
    last = 0
  function resize() {
    const rect = canvas.getBoundingClientRect()
    width = rect.width
    height = rect.height
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    cols = Math.ceil(width / cellSize)
    rows = Math.ceil(height / cellSize)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.font = `${cellSize * 0.85}px "DM Mono", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (reduced.matches) draw()
  }
  function draw() {
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#b5bab0'
    pointer.x += (pointer.tx - pointer.x) * 0.12
    pointer.y += (pointer.ty - pointer.y) * 0.12
    const r2 = cursorRadius * cursorRadius
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        let lum = noise(x * 0.35 + t * 0.22, y * 0.35, t) ** 1.7
        const px = x * cellSize + cellSize / 2,
          py = y * cellSize + cellSize / 2
        const d2 = (px - pointer.x) ** 2 + (py - pointer.y) ** 2
        if (d2 < r2 * 4) lum = Math.min(1, lum + Math.exp(-d2 / r2) * 0.7)
        const char = ramp[Math.floor(lum * (ramp.length - 1))]
        if (char !== ' ') {
          ctx.globalAlpha = 0.25 + lum * 0.75
          ctx.fillText(char, px, py)
        }
      }
    ctx.globalAlpha = 1
  }
  function loop(now: number) {
    if (now - last >= 33) {
      t += Math.min((now - (last || now)) / 1000, 0.1) * 1.68
      last = now
      draw()
    }
    frame = requestAnimationFrame(loop)
  }
  function motion() {
    cancelAnimationFrame(frame)
    last = 0
    if (reduced.matches) draw()
    else frame = requestAnimationFrame(loop)
  }
  function onPointer(event: PointerEvent) {
    const r = canvas.getBoundingClientRect()
    pointer.tx = event.clientX - r.left
    pointer.ty = event.clientY - r.top
  }
  function onLeave() {
    pointer.tx = -10000
    pointer.ty = -10000
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  window.addEventListener('pointermove', onPointer, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
  reduced.addEventListener('change', motion)
  resize()
  motion()
  return () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    window.removeEventListener('pointermove', onPointer)
    document.documentElement.removeEventListener('pointerleave', onLeave)
    reduced.removeEventListener('change', motion)
  }
})
</script>
<canvas bind:this={canvas} class="ascii-field" aria-hidden="true"></canvas>
<style>
.ascii-field {
  position: absolute;
  z-index: -1;
  pointer-events: none;
  top: -78px;
  left: 50%;
  transform: translateX(-50%);
  width: 100vw;
  height: 1000px;
  opacity: 0.34;
  mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%);
}
@media (max-width: 600px) {
  .ascii-field {
    height: 750px;
    opacity: 0.25;
  }
}
</style>
