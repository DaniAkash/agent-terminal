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
import { siApple, siGithub, siGoogleplay } from 'simple-icons'
import AsciiField from '#lib/AsciiField.svelte'
import InstallTerminal from '#lib/InstallTerminal.svelte'
import RibbonField from '#lib/RibbonField.svelte'

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
const install = 'brew tap daniakash/tap && brew install --cask agent-terminal'
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
      An open-source macOS terminal for AI coding agents. Keep your projects,
      sessions, and everything in between in view.
    </p>
    <div class="hero-actions">
      <a
        class="button button-primary"
        href="https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-aarch64.dmg"
        ><span class="simple-icon">{@html siApple.svg}</span>
        Download for macOS <ArrowDown size={16} weight="bold" /></a
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
      <a
        href="https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-x64.dmg"
        >Intel download</a
      >
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
                      'Kimi',
                      'Kimi CLI',
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
          Pair your phone with your Mac over your local network. See your
          projects, open a terminal, and keep working with your agents from
          wherever you are.
        </p>
        <div class="mobile-details">
          <span>QR code pairing</span><span>Live terminal sessions</span
          ><span>iOS + Android</span>
        </div>
        <div class="mobile-store-badges">
          <a
            class="play-badge"
            href="https://play.google.com/store/apps/details?id=com.daniakash.agent_terminal"
            target="_blank"
            rel="noreferrer"
            aria-label="Get Agent Terminal on Google Play"
            ><span class="simple-icon">{@html siGoogleplay.svg}</span
            ><span
              ><small>GET IT ON</small><strong>Google Play</strong></span
            ></a
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
          >.
        </p>
      </div>
    </div>
  </section>
  <section class="closing wrap">
    <div class="section-kicker">YOUR AGENTS ARE READY</div>
    <h2>A better home for<br>your <em>best work.</em></h2>
    <p>Bring a little more clarity to your command line.</p>
    <a
      class="button button-primary"
      href="https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-aarch64.dmg"
      ><span class="simple-icon">{@html siApple.svg}</span>
      Download for macOS <ArrowDown size={16} weight="bold" /></a
    ><span class="closing-note">FREE & OPEN SOURCE · MADE FOR MACOS</span>
  </section>
</main>
