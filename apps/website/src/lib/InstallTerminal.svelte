<script lang="ts">
import { Check, Copy } from 'phosphor-svelte'
import { onMount } from 'svelte'

let terminal: HTMLDivElement
let typed = $state('')
let step = $state(0)
let copied = $state(false)
const command = 'brew install --cask daniakash/tap/agent-terminal'
let timers: ReturnType<typeof setTimeout>[] = []
async function copy() {
  await navigator.clipboard.writeText(command)
  copied = true
  setTimeout(() => (copied = false), 2000)
}
onMount(() => {
  let started = false
  function start() {
    if (started) return
    started = true
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      typed = command
      step = 4
      return
    }
    let index = 0
    const type = () => {
      if (index < command.length) {
        typed = command.slice(0, ++index)
        timers.push(setTimeout(type, 25))
      } else {
        timers.push(
          setTimeout(() => (step = 1), 250),
          setTimeout(() => (step = 2), 600),
          setTimeout(() => (step = 3), 950),
          setTimeout(() => (step = 4), 1300),
        )
      }
    }
    type()
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        start()
        observer.disconnect()
      }
    },
    { threshold: 0.3 },
  )
  observer.observe(terminal)
  return () => {
    observer.disconnect()
    timers.forEach(clearTimeout)
  }
})
</script>
<div class="install-terminal" bind:this={terminal}>
  <div class="terminal-header">
    <div class="terminal-dots" aria-hidden="true"><i></i><i></i><i></i></div>
    <span>terminal — zsh</span
    ><button
      type="button"
      onclick={copy}
      aria-label={copied ? 'Copied install command' : 'Copy install command'}
      title={copied ? 'Copied!' : 'Copy command'}
    >
      {#if copied}
        <Check size={15} />
      {:else}
        <Copy size={15} />
      {/if}
    </button>
  </div>
  <section
    class="terminal-body"
    aria-label="Homebrew installation command and example output"
  >
    <div>
      <span class="terminal-prompt">~ % </span><span>{typed}</span
      ><span class="terminal-cursor" aria-hidden="true"></span>
    </div>
    <div class:visible={step >= 1} class="terminal-line">
      ==&gt; Tapping daniakash/tap
    </div>
    <div class:visible={step >= 2} class="terminal-line">
      ==&gt; Trusted cask daniakash/tap/agent-terminal
    </div>
    <div class:visible={step >= 3} class="terminal-line">
      ==&gt; Installing Cask agent-terminal
    </div>
    <div class:visible={step >= 4} class="terminal-line terminal-success">
      ✓ Agent Terminal is ready to open.
    </div>
  </section>
  <div class="terminal-footer">Install with Homebrew <span>macOS</span></div>
</div>
<div class="mobile-install-command">
  <span>$</span><code>{command}</code
  ><button
    type="button"
    onclick={copy}
    aria-label={copied ? 'Copied install command' : 'Copy install command'}
  >
    {#if copied}
      <Check size={16} />
    {:else}
      <Copy size={16} />
    {/if}
  </button>
</div>
