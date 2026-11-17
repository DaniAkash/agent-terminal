<script lang="ts">
import {
  ArrowUpRight,
  BookOpen,
  CaretDown,
  ClockCounterClockwise,
  DownloadSimple,
  Robot,
  SquaresFour,
  Star,
} from 'phosphor-svelte'
import { siGithub } from 'simple-icons'
import { onMount } from 'svelte'
import { page } from '$app/state'

let stars = $state<number | null>(null)
let mobileMenu: HTMLDetailsElement
const links = [
  { label: 'Features', href: '/#features', icon: SquaresFour },
  { label: 'Agents', href: '/agents', icon: Robot },
  { label: 'Downloads', href: '/downloads', icon: DownloadSimple },
  { label: 'Changelog', href: '/changelog', icon: ClockCounterClockwise },
  { label: 'Docs', href: '/docs', icon: BookOpen },
]
let active = $derived(
  page.url.pathname === '/agents'
    ? 'Agents'
    : page.url.pathname === '/downloads'
      ? 'Downloads'
      : page.url.pathname === '/changelog'
        ? 'Changelog'
        : page.url.pathname === '/docs' ||
            page.url.pathname.startsWith('/docs/')
          ? 'Docs'
          : 'Features',
)
function closeMenu() {
  mobileMenu.open = false
}
function outside(event: MouseEvent) {
  if (mobileMenu?.open && !mobileMenu.contains(event.target as Node))
    mobileMenu.open = false
}
function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && mobileMenu?.open) {
    mobileMenu.open = false
    mobileMenu.querySelector('summary')?.focus()
  }
}
onMount(() => {
  const controller = new AbortController()
  fetch('https://api.github.com/repos/DaniAkash/agent-terminal', {
    signal: controller.signal,
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (typeof data?.stargazers_count === 'number')
        stars = data.stargazers_count
    })
    .catch(() => {})
  document.addEventListener('pointerdown', outside)
  document.addEventListener('keydown', handleEscape)
  return () => {
    controller.abort()
    document.removeEventListener('pointerdown', outside)
    document.removeEventListener('keydown', handleEscape)
  }
})
</script>
<header class="notch-header">
  <div class="notch-desktop">
    <div class="notch-brand">
      <a class="brand" href="/" aria-label="Agent Terminal home"
        ><img src="/agent-terminal-icon.svg" alt="">
        <span>agent terminal<span class="brand-dot">.</span></span></a
      >
    </div>
    <nav class="notch-links" aria-label="Main navigation">
      {#each links as link}
        <a
          href={link.href}
          class:active={active === link.label}
          aria-current={active === link.label ? 'page' : undefined}
          >{link.label}</a
        >
      {/each}
    </nav>
    <div class="notch-action">
      <a
        href="https://github.com/DaniAkash/agent-terminal"
        target="_blank"
        rel="noreferrer"
        ><span class="simple-icon">{@html siGithub.svg}</span>
        GitHub
        <span class="notch-stars"
          ><Star size={13} weight="fill" />
          {#if stars !== null}
            {new Intl.NumberFormat('en', {
              notation: 'compact',
              maximumFractionDigits: 1,
            }).format(stars)}
          {/if}</span
        ><ArrowUpRight size={14} /></a
      >
    </div>
  </div>
  <div class="notch-mobile-shell">
    <details class="notch-mobile" bind:this={mobileMenu}>
      <summary aria-label="Toggle navigation menu">
        <span class="notch-current"
          >{active === 'Features' ? 'Home' : active}<CaretDown
            size={13}
          /></span
        >
      </summary>
      <nav class="notch-mobile-links" aria-label="Mobile navigation">
        {#each links as link}
          <a
            href={link.label === 'Features' ? '/' : link.href}
            class:active={active === link.label}
            aria-current={active === link.label ? 'page' : undefined}
            onclick={closeMenu}
            ><span>{link.label === 'Features' ? 'Home' : link.label}</span></a
          >
        {/each}
      </nav>
    </details>
    <a class="notch-mobile-brand" href="/" aria-label="Agent Terminal home"
      ><img src="/agent-terminal-icon.svg" alt="">
      <span>agent terminal<span class="brand-dot">.</span></span></a
    ><a
      class="notch-mobile-github"
      href="https://github.com/DaniAkash/agent-terminal"
      target="_blank"
      rel="noreferrer"
      aria-label="Agent Terminal on GitHub"
      ><span class="simple-icon">{@html siGithub.svg}</span></a
    >
  </div>
</header>
