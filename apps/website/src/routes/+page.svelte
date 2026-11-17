<script lang="ts">
import ampLogo from '@lobehub/icons-static-svg/icons/amp-color.svg'
import claudeLogo from '@lobehub/icons-static-svg/icons/claudecode-color.svg'
import codexLogo from '@lobehub/icons-static-svg/icons/codex-color.svg'
import kiloLogo from '@lobehub/icons-static-svg/icons/kilocode.svg'
import kimiLogo from '@lobehub/icons-static-svg/icons/kimi-color.svg'
import mastraLogo from '@lobehub/icons-static-svg/icons/mastra.svg'
import opencodeLogo from '@lobehub/icons-static-svg/icons/opencode.svg'
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Command,
  Copy,
  Lightning,
  Monitor,
  SquaresFour,
} from 'phosphor-svelte'
import { siApple, siGithub, siGoogleplay, siLinux } from 'simple-icons'
import { onMount } from 'svelte'
import AsciiField from '#lib/AsciiField.svelte'
import InstallTerminal from '#lib/InstallTerminal.svelte'
import RibbonField from '#lib/RibbonField.svelte'
import { LATEST_DOWNLOAD } from '../lib/releases'

const agents = [
  { name: 'Claude Code', logo: claudeLogo },
  { name: 'Codex', logo: codexLogo },
  { name: 'OpenCode', logo: opencodeLogo },
  { name: 'Amp', logo: ampLogo, experimental: true },
  { name: 'Kilo Code', logo: kiloLogo, experimental: true },
  { name: 'Kimi', logo: kimiLogo, experimental: true },
  { name: 'Mastra', logo: mastraLogo, experimental: true },
]

let copied = $state(false)
let downloadPlatform = $state<'macos' | 'linux' | null>(null)
let macArchitecture = $state<'aarch64' | 'x64'>('aarch64')
onMount(() => {
  const platform = navigator.userAgent
  if (
    /Macintosh|Mac OS X/.test(platform) &&
    !/iPhone|iPad|iPod/.test(platform)
  ) {
    downloadPlatform = 'macos'
    const hints = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues: (
            hints: string[],
          ) => Promise<{ architecture?: string }>
        }
      }
    ).userAgentData
    hints
      ?.getHighEntropyValues(['architecture'])
      .then(({ architecture }) => {
        if (architecture === 'x86') macArchitecture = 'x64'
      })
      .catch(() => {})
  } else if (
    /Linux/.test(platform) &&
    !/Android|aarch64|arm64|armv/i.test(platform)
  )
    downloadPlatform = 'linux'
})
const install = 'brew install --cask daniakash/tap/agent-terminal'
async function copyInstall() {
  await navigator.clipboard.writeText(install)
  copied = true
  setTimeout(() => (copied = false), 2000)
}
</script>

<main id="top" class="home-page">
  <section class="hero wrap">
    <AsciiField />
    <div class="hero-install">
      <span>$</span><code>{install}</code
      ><button
        type="button"
        onclick={copyInstall}
        aria-label={copied
          ? 'Copied full Homebrew command'
          : 'Copy full Homebrew installation command'}
        title={copied ? 'Copied!' : 'Copy full installation command'}
      >
        {#if copied}
          <Check size={15} />
        {:else}
          <Copy size={15} />
        {/if}
      </button>
    </div>
    <h1>
      One terminal. <span>Every agent.</span><br>Total clarity<span
        class="orange"
        >.</span
      >
    </h1>
    <p class="hero-copy">
      An open-source terminal for AI coding agents on macOS and Linux. Keep your
      projects, sessions, and everything in between in view.
    </p>
    <div class="hero-actions">
      <a
        class="button button-primary"
        href={downloadPlatform === 'macos'
          ? `${LATEST_DOWNLOAD}/agent-terminal-${macArchitecture}.dmg`
          : downloadPlatform === 'linux'
            ? `${LATEST_DOWNLOAD}/agent-terminal-amd64.AppImage`
            : '/downloads'}
        >{#if downloadPlatform}
          <span class="simple-icon"
            >{@html downloadPlatform === 'macos'
              ? siApple.svg
              : siLinux.svg}</span
          >
        {/if}
        {downloadPlatform === 'macos'
          ? `Download for macOS (${macArchitecture === 'x64' ? 'Intel' : 'Apple Silicon'})`
          : downloadPlatform === 'linux'
            ? 'Download for Linux (x86-64)'
            : 'Download Agent Terminal'}
        <ArrowDown size={16} weight="bold" /></a
      ><a
        class="button button-secondary"
        href="https://github.com/DaniAkash/agent-terminal"
        target="_blank"
        rel="noreferrer"
        ><span class="simple-icon">{@html siGithub.svg}</span>
        View on GitHub <ArrowUpRight size={15} /></a
      >
    </div>
    <p class="availability">
      Free and open source <span>·</span> macOS 13+ <span>·</span>
      <a href="/downloads">All downloads · Intel Mac · Linux</a>
    </p>
    <div class="hero-visual">
      <div class="hero-image-frame">
        <img
          class="hero-screenshot"
          src="/illustrations/terminal-hero.webp"
          width="2550"
          height="1632"
          fetchpriority="high"
          alt="Agent Terminal showing project workspaces, terminal sessions, and live status"
        >
      </div>
    </div>
  </section>

  <section
    class="agent-strip"
    id="agents"
    aria-label="Supported and experimental agents"
  >
    <div class="wrap strip-inner">
      <div class="strip-intro">
        <span class="strip-label">YOUR AGENTS, RIGHT AT HOME</span>
        <p>
          Works with your favorites.<br><span>More joining the workspace.</span>
        </p>
      </div>
      <div
        role="img"
        class="marquee"
        aria-label="Claude Code, Codex and OpenCode supported; Amp, Kilo Code, Kimi and Mastra experimental"
      >
        <div class="marquee-track">
          {#each [0, 1] as copy}
            <div
              class="marquee-group"
              aria-hidden={copy === 1 ? 'true' : undefined}
            >
              {#each agents as agent}
                <div class="agent-item">
                  <img
                    src={agent.logo}
                    alt=""
                    class:brand-color={[
                      'Claude Code',
                      'Codex',
                      'Codex CLI',
                      'Amp',
                    ].includes(agent.name)}
                  ><span>{agent.name}</span>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    </div>
  </section>

  <section class="features wrap" id="features">
    <div class="section-heading">
      <div>
        <span class="section-kicker">THE WORKSPACE</span>
        <h2>Made for the way<br>you build <em>now.</em></h2>
      </div>
      <p>
        More agents shouldn't mean more chaos. Agent Terminal gives every
        project and every session a place to live.
      </p>
    </div>
    <div class="feature-grid">
      <article class="feature-card feature-wide">
        <div class="feature-text">
          <div class="feature-icon"><SquaresFour size={22} /></div>
          <h3>Everything in its right place.</h3>
          <p>
            Group your tabs by project and pick up right where you left off.
            Your sessions remember their working directories, so switching
            context doesn't mean losing it.
          </p>
        </div>
        <div class="capture-stage">
          <RibbonField />
          <div class="capture-window capture-project">
            <img
              src="/illustrations/captures/projects-context.webp"
              alt="Agent Terminal project sidebar"
            >
          </div>
        </div>
      </article>
      <article class="feature-card">
        <div class="feature-icon"><Lightning size={22} /></div>
        <h3>Know who's doing what.</h3>
        <p>
          Agent Terminal recognizes Claude Code, Codex, and opencode, and shows
          their state right alongside your sessions.
        </p>
        <div class="capture-stage">
          <RibbonField />
          <div class="capture-window capture-agent">
            <img
              src="/illustrations/captures/agents-context.webp"
              alt="Agent Terminal sidebar showing agent badges"
            >
          </div>
        </div>
      </article>
      <article class="feature-card">
        <div class="feature-icon"><Monitor size={22} /></div>
        <h3>The details, without the digging.</h3>
        <p>
          See your process, memory, ports, git branch, and working directory in
          a live status bar. No extra commands required.
        </p>
        <div class="capture-stage">
          <RibbonField />
          <div class="capture-window capture-bar">
            <img
              src="/illustrations/captures/status-context.webp"
              alt="Agent Terminal status bar showing process, memory, branch, and directory"
            >
          </div>
        </div>
      </article>
      <article class="feature-card feature-wide feature-last">
        <div class="feature-text">
          <div class="feature-icon"><Command size={22} /></div>
          <h3>Every session. One view.</h3>
          <p>
            Keep your terminal sessions together in project tabs, with the
            active agent and branch visible at a glance.
          </p>
        </div>
        <div class="capture-stage">
          <RibbonField />
          <div class="capture-window capture-tabs">
            <img
              src="/illustrations/captures/tabs-context.webp"
              alt="Agent Terminal tabs and active session"
            >
          </div>
        </div>
      </article>
    </div>
  </section>

  <section class="mobile-section" id="mobile">
    <div class="wrap mobile-inner">
      <div class="mobile-copy">
        <div class="section-kicker">THE MOBILE COMPANION</div>
        <h2>Your terminal,<br><em>in your pocket.</em></h2>
        <p>
          Android and iOS companions are coming soon, with plans to pair your
          phone with your desktop and access terminal sessions over your local
          network.
        </p>
        <div class="mobile-details">
          <span>QR code pairing</span><span>Live terminal sessions</span
          ><span>iOS + Android</span>
        </div>
        <div class="mobile-store-badges">
          <span class="appstore-soon"
            ><span class="simple-icon">{@html siGoogleplay.svg}</span
            ><span
              ><small>GOOGLE PLAY</small><strong>Coming soon</strong></span
            ></span
          ><span class="appstore-soon"
            ><span class="simple-icon">{@html siApple.svg}</span
            ><span
              ><small>APP STORE</small><strong>Coming soon</strong></span
            ></span
          >
        </div>
      </div>
      <div
        role="img"
        class="phone-stage"
        aria-label="Illustration of the Agent Terminal mobile companion"
      >
        <div class="phone">
          <div class="phone-notch"></div>
          <div class="phone-header"><span>9:41</span><span>●●●</span></div>
          <div class="phone-title">
            <span class="phone-brand"
              ><img src="/agent-terminal-icon.svg" alt="">
              Agent Terminal</span
            ><span>＋</span>
          </div>
          <div class="phone-page-title">Projects</div>
          <div class="phone-subtitle">YOUR WORKSPACES</div>
          <div class="phone-project">
            <span class="phone-project-name">▾ &nbsp; agent-terminal</span
            ><small>3 sessions</small>
          </div>
          <div class="phone-tab">
            <span>●</span>
            &nbsp; Keyboard-support <small>Claude</small>
          </div>
          <div class="phone-tab active">
            <span>●</span>
            &nbsp; windows-support <small>Codex</small>
          </div>
          <div class="phone-tab">
            <span>●</span>
            &nbsp; dev-server <small>zsh</small>
          </div>
          <div class="phone-project">
            <span>▸ &nbsp; mobile-app</span><small>1 session</small>
          </div>
          <div class="phone-bottom">
            ⌘ &nbsp; Projects <span>Settings &nbsp; ⚙</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="install-section" id="open-source">
    <div class="wrap install-inner">
      <div>
        <div class="section-kicker">YOURS TO BUILD ON</div>
        <h2>Open source.<br><em>Open terminal.</em></h2>
        <p>
          Built in the open, for developers who live in the terminal. Free to
          use, inspect, and make your own.
        </p>
        <a
          class="text-link"
          href="https://github.com/DaniAkash/agent-terminal"
          target="_blank"
          rel="noreferrer"
          >Explore the repository <ArrowUpRight size={16} /></a
        >
      </div>
      <div class="install-options">
        <InstallTerminal />
        <p class="dmg-options">
          Prefer a DMG? Download for
          <a
            href="https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-aarch64.dmg"
            >Apple Silicon</a
          >
          or
          <a
            href="https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-x64.dmg"
            >Intel</a
          >. <a href="/downloads">Explore all downloads, including Linux</a>.
        </p>
      </div>
    </div>
  </section>
  <section class="faq-section wrap" aria-labelledby="faq-heading">
    <div class="faq-intro">
      <div class="section-kicker">GOOD TO KNOW</div>
      <h2 id="faq-heading">A few common<br><em>questions.</em></h2>
      <p>Everything you need to know before getting started.</p>
    </div>
    <div class="faq-list">
      <details>
        <summary>
          What is Agent Terminal?<span aria-hidden="true">+</span>
        </summary>
        <p>
          It’s an open-source terminal workspace that organizes sessions by
          project and surfaces context about your coding agents, processes, and
          Git state.
        </p>
      </details>
      <details>
        <summary>
          Which coding agents can I use?<span aria-hidden="true">+</span>
        </summary>
        <p>
          Claude Code, Codex CLI, and opencode are supported. Amp, Kilo Code,
          Kimi CLI, and Mastra are experimental. Install each agent separately.
          <a href="/agents">See all integrations</a>.
        </p>
      </details>
      <details>
        <summary>
          Does it work with my existing shell and tools?<span aria-hidden="true"
            >+</span
          >
        </summary>
        <p>
          Yes. Your shell and CLI tools remain available in your terminal
          sessions. Zsh is the daily-driver shell; Bash has been lightly tested.
        </p>
      </details>
      <details>
        <summary>
          Which platforms are supported?<span aria-hidden="true">+</span>
        </summary>
        <p>
          Agent Terminal is stable on macOS 13 and later, on both Apple Silicon
          and Intel. Linux x86-64 builds are experimental; Windows needs more
          testing and contributions. <a href="/downloads">Explore downloads.</a>
        </p>
      </details>
      <details>
        <summary>
          Is Agent Terminal free?<span aria-hidden="true">+</span>
        </summary>
        <p>
          Yes. Agent Terminal is free and open source under the MIT license.
          Coding agents and their providers may have their own pricing.
        </p>
      </details>
      <details>
        <summary>
          Can I access my sessions from my phone?<span aria-hidden="true"
            >+</span
          >
        </summary>
        <p>
          Android and iOS companion apps are coming soon. They are designed to
          pair with your desktop over your local network for access to projects
          and terminal sessions.
        </p>
      </details>
    </div>
  </section>
  <section class="closing wrap">
    <div class="section-kicker">YOUR AGENTS ARE READY</div>
    <h2>A better home for<br>your <em>best work.</em></h2>
    <p>Bring a little more clarity to your command line.</p>
    <a class="button button-primary" href="/downloads"
      >Download Agent Terminal <ArrowDown size={16} weight="bold" /></a
    ><span class="closing-note">FREE & OPEN SOURCE · MACOS & LINUX</span>
  </section>
</main>
