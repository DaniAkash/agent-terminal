<script lang="ts">
import { onMount } from 'svelte'

let field: HTMLDivElement
const blobs = [
  {
    x: 65.34,
    y: 44.62,
    rgb: '52,52,50',
    stops: [8.53, 17.05, 25.58, 34.1],
    p: 1.16,
    p2: 3.71,
  },
  {
    x: 28.07,
    y: 74.48,
    rgb: '18,18,17',
    stops: [11.15, 22.3, 33.45, 44.6],
    p: 4.2,
    p2: 0.83,
  },
  {
    x: 52.42,
    y: 19.94,
    rgb: '52,52,50',
    stops: [14.13, 28.25, 42.38, 56.5],
    p: 2.68,
    p2: 5.14,
  },
  {
    x: 80.31,
    y: 84.47,
    rgb: '0,0,0',
    stops: [17.27, 34.55, 51.82, 69.1],
    p: 5.63,
    p2: 2.32,
  },
]
onMount(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let frame = 0
  let start: number | undefined
  function draw(now: number) {
    if (start === undefined) start = now
    const ph = reduced.matches ? 0 : ((now - start) / 1000) * 0.77
    field.style.backgroundImage = blobs
      .map(({ x, y, rgb, stops, p, p2 }) => {
        const cx = x + (Math.sin(ph * 0.55 + p) - Math.sin(p)) * 14
        const cy = y + (Math.sin(ph * 0.43 + p2) - Math.sin(p2)) * 14
        return `radial-gradient(circle at ${cx}% ${cy}%, rgba(${rgb},1) 0%, rgba(${rgb},.844) ${stops[0]}%, rgba(${rgb},.5) ${stops[1]}%, rgba(${rgb},.156) ${stops[2]}%, rgba(${rgb},0) ${stops[3]}%)`
      })
      .join(',')
    if (!reduced.matches) frame = requestAnimationFrame(draw)
  }
  function restart() {
    cancelAnimationFrame(frame)
    start = undefined
    frame = requestAnimationFrame(draw)
  }
  restart()
  reduced.addEventListener('change', restart)
  return () => {
    cancelAnimationFrame(frame)
    reduced.removeEventListener('change', restart)
  }
})
</script>
<div bind:this={field} class="bloom" aria-hidden="true"></div>
<style>
.bloom {
  position: absolute;
  z-index: -1;
  pointer-events: none;
  top: -78px;
  left: 50%;
  transform: translateX(-50%);
  width: 100vw;
  height: 1050px;
  background-color: #000;
  background-image:
    radial-gradient(circle at 65.34% 44.62%, #343432 0%, transparent 34.1%),
    radial-gradient(circle at 28.07% 74.48%, #121211 0%, transparent 44.6%),
    radial-gradient(circle at 52.42% 19.94%, #343432 0%, transparent 56.5%),
    radial-gradient(circle at 80.31% 84.47%, #000 0%, transparent 69.1%);
  mask-image: linear-gradient(#000 65%, transparent 100%);
}
</style>
