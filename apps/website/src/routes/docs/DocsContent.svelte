<script lang="ts">
import { ArrowUpRight, BookOpen, Check, Copy } from 'phosphor-svelte'
import { onMount } from 'svelte'
import { goto } from '$app/navigation'
import { docSections } from './doc-sections'
import { siApple, siIntel } from 'simple-icons'
import LinuxInstallation from '#lib/LinuxInstallation.svelte'
let { section = 'overview' }: { section?: string } = $props()
let copied = $state(false)
const command = 'brew install --cask daniakash/tap/agent-terminal'
async function copy() {
  await navigator.clipboard.writeText(command)
  copied = true
  setTimeout(() => (copied = false), 2000)
}
const sections = docSections
let currentIndex = $derived(sections.findIndex((item) => item.id === section))
let previous = $derived(sections[currentIndex - 1])
let next = $derived(sections[currentIndex + 1])
let current = $derived(sections[currentIndex])
const groups = [
  {
    label: 'GET STARTED',
    ids: ['overview', 'installation', 'linux-installation'],
  },
  {
    label: 'USE AGENT TERMINAL',
    ids: ['projects', 'agents', 'status-bar', 'agent-usage', 'mobile'],
  },
  { label: 'REFERENCE', ids: ['shortcuts', 'platforms', 'contributing'] },
]
const hrefFor = (id: string) => (id === 'overview' ? '/docs' : `/docs/${id}`)
const pageHeadings: Record<string, { id: string; label: string }[]> = {
  installation: [
    { id: 'installation', label: 'Install the app' },
    { id: 'first-launch', label: 'First launch' },
  ],
  'linux-installation': [
    { id: 'linux-installation', label: 'Before you begin' },
    { id: 'appimage', label: 'AppImage' },
    { id: 'ubuntu-debian', label: 'Ubuntu and Debian' },
    { id: 'fedora', label: 'Fedora' },
    { id: 'arch', label: 'Arch Linux' },
    { id: 'linux-troubleshooting', label: 'Troubleshooting' },
  ],
  projects: [
    { id: 'projects', label: 'Projects and tabs' },
    { id: 'keep-context', label: 'Keep context' },
  ],
  agents: [
    { id: 'agents', label: 'Agent integrations' },
    { id: 'detection', label: 'How detection works' },
  ],
  'agent-usage': [
    { id: 'agent-usage', label: 'Agent Usage limits' },
    { id: 'gauges', label: 'Reading the gauges' },
    { id: 'refresh', label: 'Refresh and troubleshooting' },
  ],
  mobile: [
    { id: 'mobile', label: 'Mobile companion' },
    { id: 'pair-device', label: 'Pair a device' },
  ],
  'status-bar': [{ id: 'status-bar', label: 'The status bar' }],
  shortcuts: [{ id: 'shortcuts', label: 'Keyboard shortcuts' }],
  platforms: [{ id: 'platforms', label: 'Platforms and shells' }],
  contributing: [
    { id: 'contributing', label: 'Contributing' },
    { id: 'development-commands', label: 'Development commands' },
  ],
}
onMount(() => {
  // Preserve links to sections from before documentation had separate URLs.
  if (section === 'overview' && window.location.hash) {
    const id = window.location.hash.slice(1)
    if (sections.some((item) => item.id === id && id !== 'overview'))
      void goto(`/docs/${id}`, { replaceState: true })
  }
})
</script>
<main class="docs-page">
  <div class="docs-shell">
    <aside class="docs-sidebar">
      <div class="docs-sidebar-title"><BookOpen size={16} /> DOCUMENTATION</div>
      <nav aria-label="Documentation sections">
        {#each groups as group}
          <span class="docs-nav-group">{group.label}</span>
          {#each sections.filter((item) => group.ids.includes(item.id)) as item}
            <a
              href={hrefFor(item.id)}
              aria-current={item.id === section ? 'page' : undefined}
              >{item.label}</a
            >
          {/each}
        {/each}
      </nav>
      <a
        class="docs-source"
        href="https://github.com/DaniAkash/agent-terminal"
        target="_blank"
        rel="noreferrer"
        >View source <ArrowUpRight size={14} /></a
      >
    </aside>
    <article class="docs-content">
      {#if section === 'overview'}
        <header class="docs-intro" id="overview">
          <span class="docs-kicker">AGENT TERMINAL / DOCUMENTATION</span>
          <h1>Make yourself<br><span>at home.</span></h1>
          <p>
            Everything you need to get started with a terminal built around your
            coding agents.
          </p>
          <div class="docs-intro-links">
            <a href="/docs/installation">Get started <span>↓</span></a
            ><a href="/agents">Explore agents <ArrowUpRight size={14} /></a>
          </div>
        </header>
      {/if}
      {#if section !== 'overview'}
        <header class="docs-intro docs-article-intro">
          <span class="docs-kicker">AGENT TERMINAL / DOCUMENTATION</span>
          <h1>{current?.label}</h1>
          <p>{current?.description}</p>
        </header>
      {/if}
      <details class="docs-mobile-nav">
        <summary>Documentation <span>{current?.label}</span></summary>
        <nav aria-label="Documentation sections">
          {#each sections as item}
            <a
              href={hrefFor(item.id)}
              aria-current={item.id === section ? 'page' : undefined}
              >{item.label}</a
            >
          {/each}
        </nav>
      </details>
      {#if section === 'overview'}
        <section class="docs-welcome" aria-labelledby="explore-docs">
          <div class="docs-kicker">FIND YOUR WAY</div>
          <h2 id="explore-docs">What would you like to do?</h2>
          <div class="docs-welcome-grid">
            <a href="/docs/installation"
              ><strong>Install the app</strong
              ><span>Set up on macOS and open your first project.</span></a
            >
            <a href="/docs/linux-installation"
              ><strong>Get started on Linux</strong
              ><span
                >Choose a package for your distribution and troubleshoot
                setup.</span
              ></a
            >
            <a href="/docs/agents"
              ><strong>Work with agents</strong
              ><span>Learn how coding agents appear in your workspace.</span></a
            >
            <a href="/docs/shortcuts"
              ><strong>Find a shortcut</strong
              ><span>Move between projects and terminal tabs.</span></a
            >
          </div>
        </section>
      {/if}
      {#if section === 'installation'}
        <section class="docs-section" id="installation">
          <span class="docs-kicker">01 / GET STARTED</span>
          <h2>Installation</h2>
          <p>
            Agent Terminal is stable on macOS 13 and later, with Zsh as its
            daily-driver shell. Download the build for your Mac or install it
            using Homebrew. Experimental Linux x86-64 builds are available as
            AppImage, Debian and RPM packages.
            <a href="/downloads">See all downloads</a>. For
            distribution-specific steps, see the
            <a href="/docs/linux-installation">Linux installation guide</a>.
          </p>
          <div class="docs-downloads">
            <a
              href="https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-aarch64.dmg"
              ><span class="simple-icon" aria-hidden="true"
                >{@html siApple.svg}</span
              >
              Apple Silicon <ArrowUpRight size={14} /></a
            ><a
              href="https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-x64.dmg"
              ><span class="simple-icon" aria-hidden="true"
                >{@html siIntel.svg}</span
              >
              Intel <ArrowUpRight size={14} /></a
            >
          </div>
          <div class="docs-code">
            <div>
              <span>HOMEBREW</span
              ><button
                type="button"
                onclick={copy}
                aria-label={copied
                  ? 'Copied command'
                  : 'Copy installation command'}
              >
                {#if copied}
                  <Check size={16} />
                {:else}
                  <Copy size={16} />
                {/if}
              </button>
            </div>
            <code><span>$</span> {command}</code>
          </div>
          <h3 id="first-launch">First launch</h3>
          <ol>
            <li>
              Open Agent Terminal and create a project for a directory you work
              in.
            </li>
            <li>
              Open a tab in that project. Your shell starts in the project
              workspace.
            </li>
            <li>
              Install your preferred agent using its own setup guide, then
              launch it from the tab.
            </li>
          </ol>
          <p>
            Already have a terminal workflow? Your shell and CLI tools remain
            available. Agent Terminal adds project organization and session
            context around them.
          </p>
        </section>
      {/if}
      {#if section === 'linux-installation'}
        <LinuxInstallation />
      {/if}
      {#if section === 'projects'}
        <section class="docs-section" id="projects">
          <span class="docs-kicker">02 / WORKSPACE</span>
          <h2>Projects and tabs</h2>
          <p>
            Organize related sessions under projects and switch between them
            without losing your place. Tabs remember their working directory and
            reopen there.
          </p>
          <h3 id="keep-context">Keep context between sessions</h3>
          <p>
            Projects group tabs by the work they belong to. Each tab remembers
            its working directory, so reopening a project helps you return to
            the right place. The sidebar and tab bar give you ways to move
            between active sessions.
          </p>
          <div class="docs-callout">
            <strong>Find a recent session</strong>
            <p>
              Press <kbd class="command-key">⌘</kbd> <kbd>P</kbd> to open the
              recent-tabs switcher. Type to filter and press Enter to jump back
              in.
            </p>
          </div>
        </section>
      {/if}
      {#if section === 'agents'}
        <section class="docs-section" id="agents">
          <span class="docs-kicker">03 / INTEGRATIONS</span>
          <h2>Work with your agents</h2>
          <p>
            Install your preferred coding agent separately, then run it in an
            Agent Terminal tab. The workspace recognizes supported agents and
            surfaces their identity and activity state.
          </p>
          <div class="docs-detail-grid">
            <div>
              <strong>Supported</strong>
              <p>Claude Code, Codex CLI, and opencode.</p>
            </div>
            <div>
              <strong>Experimental</strong>
              <p>
                Amp, Kilo Code, Kimi CLI, and Mastra. Detection works and is
                still being tested.
              </p>
            </div>
          </div>
          <h3 id="detection">How detection works</h3>
          <p>
            Agent Terminal identifies a running agent and combines available
            signals such as lifecycle hooks, terminal titles, and process
            activity. Integration methods differ by agent: for example, Claude
            Code and Codex use native hooks, while opencode uses a session
            plugin. Amp uses terminal-title signals.
          </p>
          <p>
            Agent support is independent of provider usage in Agent Usage
            limits. An installed CLI may still need its own sign-in, and
            experimental integrations may need further testing.
          </p>
          <a class="docs-link" href="/agents"
            >See all agent integrations <ArrowUpRight size={14} /></a
          >
        </section>
      {/if}
      {#if section === 'status-bar'}
        <section class="docs-section" id="status-bar">
          <span class="docs-kicker">04 / LIVE CONTEXT</span>
          <h2>The status bar</h2>
          <p>
            The status bar follows the focused tab and refreshes its context
            regularly, so you can see what’s running without leaving the
            terminal.
          </p>
          <ul>
            <li>Process name, PID, elapsed time, and memory usage</li>
            <li>Listening TCP ports and the current working directory</li>
            <li>Git branch, dirty state, and ahead/behind information</li>
            <li>Detected agent and model information when available</li>
          </ul>
          <p>
            Use the theme control in the status bar to choose light, dark, or
            system appearance for the workspace and terminal.
          </p>
        </section>
      {/if}
      {#if section === 'agent-usage'}
        <section class="docs-section" id="agent-usage">
          <span class="docs-kicker">05 / PROVIDER USAGE</span>
          <h2>Agent Usage limits</h2>
          <p>
            Agent Usage limits shows provider usage and reset windows. Open
            <strong>Agent Usage limits</strong>
            from the status bar, choose
            <strong>Settings</strong>, enable it, and select the providers you
            want to track. Sources remain off until selected.
          </p>
          <p>
            Hover or focus the Agent Usage limits button for compact gauges, or
            open it for details. Usage access depends on the enabled provider
            and an existing local session or key. Unavailable data is shown as
            unavailable.
          </p>
          <div class="docs-callout">
            <strong>Provider access stays opt-in</strong>
            <p>
              Credentials are read for enabled providers; Agent Usage limits
              does not save them or send them to the frontend. It reports
              provider quotas, not estimated model spending.
            </p>
          </div>
          <h3 id="gauges">Reading the gauges</h3>
          <p>
            The hover panel can show a weekly outer arc and an hourly or session
            inner arc when those windows are reported. Unknown windows remain
            empty. In an agent tab, the status bar follows that agent’s
            available session allowance or account status; weekly readings
            remain in the hover panel and usage dialog.
          </p>
          <h3 id="refresh">Refresh and troubleshooting</h3>
          <p>
            Agent Usage limits refreshes every five minutes by default; manual,
            one-minute, and fifteen-minute modes are also available. Use
            <strong>Refresh</strong>
            after changing credentials. If a provider session has expired, renew
            it in that provider’s CLI. Claude Code may require explicitly
            authorizing Keychain access from its usage card.
          </p>
          <p>
            Agent Usage limits detects installed executables at startup and
            periodically thereafter. Use <strong>Rescan</strong> in Settings to
            check immediately. If an executable is not found, make sure its
            install location is available to the desktop process’s PATH.
          </p>
          <a
            class="docs-link"
            href="https://github.com/DaniAkash/agent-terminal/blob/main/docs/agent-usage.md"
            target="_blank"
            rel="noreferrer"
            >Read the full Agent Usage limits guide
            <ArrowUpRight size={14} /></a
          >
        </section>
      {/if}
      {#if section === 'mobile'}
        <section class="docs-section" id="mobile">
          <span class="docs-kicker">06 / COMPANION</span>
          <h2>On your phone</h2>
          <p>
            The Android and iOS companion apps are coming soon. They are
            intended to pair with the desktop app and provide access to projects
            and terminal sessions.
          </p>
          <h3 id="pair-device">How pairing works</h3>
          <p>
            When the companion is available, the pairing flow is designed to
            work as follows:
          </p>
          <ol>
            <li>
              Open the companion pairing dialog on the desktop to display its QR
              code.
            </li>
            <li>
              Scan the code from the mobile app and verify the fingerprint shown
              by the pairing flow.
            </li>
            <li>
              After pairing, choose your desktop and open a project or terminal
              session.
            </li>
          </ol>
          <p>
            The desktop’s paired-devices list lets you revoke access. A revoked
            device needs to pair again before it can reconnect.
          </p>
          <a
            class="docs-link"
            href="https://github.com/DaniAkash/agent-terminal/tree/main/apps/companion"
            target="_blank"
            rel="noreferrer"
            >Explore the companion source <ArrowUpRight size={14} /></a
          >
        </section>
      {/if}
      {#if section === 'shortcuts'}
        <section class="docs-section" id="shortcuts">
          <span class="docs-kicker">07 / KEYBOARD</span>
          <h2>Keyboard shortcuts</h2>
          <p>
            Move around your workspace without leaving the keyboard. The Command
            key shown below is macOS notation; Linux keyboard behavior is
            experimental and may vary with the desktop environment.
          </p>
          <div class="docs-table-wrap">
            <table class="docs-table">
              <thead>
                <tr>
                  <th scope="col">ACTION</th>
                  <th scope="col">SHORTCUT</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>New tab in the active project</td>
                  <td><kbd class="command-key">⌘</kbd> + <kbd>T</kbd></td>
                </tr>
                <tr>
                  <td>Close the active tab (unpinned)</td>
                  <td><kbd class="command-key">⌘</kbd> + <kbd>W</kbd></td>
                </tr>
                <tr>
                  <td>Next tab</td>
                  <td>
                    <kbd class="command-key">⌘</kbd>
                    + <kbd>Shift</kbd> + <kbd>]</kbd> or <kbd>Ctrl</kbd> +
                    <kbd>Tab</kbd>
                  </td>
                </tr>
                <tr>
                  <td>Previous tab</td>
                  <td>
                    <kbd class="command-key">⌘</kbd>
                    + <kbd>Shift</kbd> + <kbd>[</kbd> or <kbd>Ctrl</kbd> +
                    <kbd>Shift</kbd>
                    + <kbd>Tab</kbd>
                  </td>
                </tr>
                <tr>
                  <td>Jump to project 1–9</td>
                  <td>
                    <kbd class="command-key">⌘</kbd>
                    + <kbd>1</kbd> … <kbd>9</kbd>
                  </td>
                </tr>
                <tr>
                  <td>Open recent-tabs switcher</td>
                  <td><kbd class="command-key">⌘</kbd> + <kbd>P</kbd></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      {/if}
      {#if section === 'platforms'}
        <section class="docs-section" id="platforms">
          <span class="docs-kicker">08 / COMPATIBILITY</span>
          <h2>Platforms and shells</h2>
          <p>
            Agent Terminal is daily-driven on macOS with Zsh. Other platforms
            and shells need more testing and contributions.
          </p>
          <p>
            Linux x86-64 builds are experimental. Choose a package and follow
            the <a href="/docs/linux-installation">Linux installation guide</a>
            for distribution-specific steps and troubleshooting.
          </p>
          <div class="docs-table-wrap">
            <table class="docs-table">
              <thead>
                <tr>
                  <th scope="col">PLATFORM OR SHELL</th>
                  <th scope="col">STATUS</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>macOS 13+ · Apple Silicon / Intel</td>
                  <td>Daily driver</td>
                </tr>
                <tr>
                  <td>Zsh</td>
                  <td>Daily driver</td>
                </tr>
                <tr>
                  <td>Bash</td>
                  <td>Lightly tested</td>
                </tr>
                <tr>
                  <td>Linux · x86-64</td>
                  <td>Experimental · AppImage, Debian and RPM</td>
                </tr>
                <tr>
                  <td>Windows</td>
                  <td>Untested · contributors wanted</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      {/if}
      {#if section === 'contributing'}
        <section class="docs-section" id="contributing">
          <span class="docs-kicker">09 / BUILD WITH US</span>
          <h2>Contributing</h2>
          <p>
            Agent Terminal is open source under the MIT license. Bug reports,
            agent integrations, and help testing Linux and Windows are welcome.
          </p>
          <p>
            For desktop development, the repository lists macOS 13+, Rust, Bun,
            and Xcode command line tools as prerequisites. Clone your fork,
            install dependencies with <code>bun install</code>, then run
            <code>bun run tauri:dev</code>.
          </p>
          <h3 id="development-commands">Useful development commands</h3>
          <div class="docs-code docs-dev-code">
            <div><span>FROM THE REPOSITORY ROOT</span></div>
            <code
              >bun install<br>bun run tauri:dev<br>bun run check<br>bun run
              tauri:build</code
            >
          </div>
          <p>
            The agent registry lives under
            <code>apps/desktop/src-tauri/src/agents/</code>. The contribution
            guide explains how profiles, hooks, plugins, and terminal signals
            fit together when adding an integration.
          </p>
          <div class="docs-end-links">
            <a
              href="https://github.com/DaniAkash/agent-terminal/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noreferrer"
              >Contributing guide <ArrowUpRight size={14} /></a
            ><a
              href="https://github.com/DaniAkash/agent-terminal/issues"
              target="_blank"
              rel="noreferrer"
              >Open an issue <ArrowUpRight size={14} /></a
            >
          </div>
        </section>
      {/if}
      <nav class="docs-pagination" aria-label="Documentation page navigation">
        {#if previous}
          <a href={hrefFor(previous.id)}
            ><small>PREVIOUS</small><span>← {previous.label}</span></a
          >
        {/if}
        {#if next}
          <a href={hrefFor(next.id)}
            ><small>NEXT</small><span>{next.label} →</span></a
          >
        {/if}
      </nav>
    </article>
    <aside class="docs-aside">
      {#if pageHeadings[section]}
        <span>ON THIS PAGE</span>
        <nav aria-label="On this page" class="docs-toc">
          {#each pageHeadings[section] as heading}
            <a href={`#${heading.id}`}>{heading.label}</a>
          {/each}
        </nav>
      {:else}
        <span>GET STARTED</span>
        <p>From first launch to your next contribution.</p>
      {/if}
      <a
        href="https://github.com/DaniAkash/agent-terminal/blob/main/README.md"
        target="_blank"
        rel="noreferrer"
        >Repository README <ArrowUpRight size={13} /></a
      >
    </aside>
  </div>
</main>
