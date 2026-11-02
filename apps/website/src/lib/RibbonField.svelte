<script lang="ts">
import { onMount } from 'svelte'

let canvas: HTMLCanvasElement

onMount(() => {
  const context = canvas.getContext('2d')
  if (!context) return
  const width = 200
  const height = 120
  canvas.width = width
  canvas.height = height
  const frame = context.createImageData(width, height)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let animation = 0
  let start: number | undefined
  const smooth = (a: number, b: number, x: number) => {
    const v = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return v * v * (3 - 2 * v)
  }
  function draw(time: number) {
    if (start === undefined) start = time
    const t = reduced.matches ? 0 : (time - start) / 1000
    const ph = t * 0.52
    const angle = ((306 + Math.sin(ph * 0.6) * 28 * 0.35) * Math.PI) / 180
    const waveClock = 20.75 + ph * 1.2
    const dx = Math.sin(angle)
    const dy = -Math.cos(angle)
    const span = Math.abs(dx) + Math.abs(dy)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = (x + 0.5) / width - 0.5
        const ny = (y + 0.5) / height - 0.5
        const cross = nx * -dy + ny * dx
        const bend =
          (8 / 100) * 0.35 * Math.sin(cross * 2.4 * 2 * Math.PI + waveClock)
        const pos = 0.5 + (nx * dx + ny * dy) / span + bend
        const mid = smooth(0.355, 0.3927, pos)
        const light = smooth(0.8173, 0.855, pos)
        const grain = (((x * 73 + y * 151 + x * y * 17) % 101) / 100 - 0.5) * 17
        const radius = Math.hypot(nx, ny) / Math.SQRT1_2
        const vignette = 1 - 0.08 * smooth(0.52, 1, radius)
        const value = Math.max(
          0,
          Math.min(255, (58 * mid + (167 - 58) * light + grain) * vignette),
        )
        const i = (y * width + x) * 4
        frame.data[i] = value
        frame.data[i + 1] = value
        frame.data[i + 2] = value
        frame.data[i + 3] = 255
      }
    }
    context!.putImageData(frame, 0, 0)
    if (!reduced.matches) animation = requestAnimationFrame(draw)
  }
  function updateMotion() {
    cancelAnimationFrame(animation)
    start = undefined
    animation = requestAnimationFrame(draw)
  }
  updateMotion()
  reduced.addEventListener('change', updateMotion)
  return () => {
    cancelAnimationFrame(animation)
    reduced.removeEventListener('change', updateMotion)
  }
})
</script>

<canvas bind:this={canvas} class="ribbon-field" aria-hidden="true"></canvas>

<style>
.ribbon-field {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
