<script lang="ts">
import { ArrowUpRight, BookOpen, Check, Copy } from 'phosphor-svelte'

let copied = $state(false)
const command = 'brew install --cask daniakash/tap/agent-terminal'
async function copy() {
  await navigator.clipboard.writeText(command)
  copied = true
  setTimeout(() => (copied = false), 2000)
}
const sections = [
  { label: 'Overview', id: 'overview' },
  { label: 'Installation', id: 'installation' },
  { label: 'Projects & tabs', id: 'projects' },
  { label: 'Agent integrations', id: 'agents' },
  { label: 'Status bar', id: 'status-bar' },
  { label: 'Jarvis usage', id: 'jarvis' },
  { label: 'Mobile companion', id: 'mobile' },
  { label: 'Keyboard shortcuts', id: 'shortcuts' },
  { label: 'Platforms', id: 'platforms' },
  { label: 'Contributing', id: 'contributing' },
]
</script>
<main class="docs-page">
  <div class="docs-shell">
    <aside class="docs-sidebar">
      <div class="docs-sidebar-title"><BookOpen size={16} /> DOCUMENTATION</div>
      <nav aria-label="Documentation sections">
        {#each sections as section}
          <a href={`#${section.id}`}>{section.label}</a>
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
      <header class="docs-intro" id="overview">
        <span class="docs-kicker">AGENT TERMINAL / DOCUMENTATION</span>
        <h1>Make yourself<br><span>at home.</span></h1>
        <p>
          Everything you need to get started with a terminal built around your
          coding agents.
        </p>
        <div class="docs-intro-links">
          <a href="#installation">Get started <span>↓</span></a
          ><a href="/agents">Explore agents <ArrowUpRight size={14} /></a>
        </div>
      </header>
      <nav class="docs-mobile-nav" aria-label="Documentation sections">
        {#each sections as section}
          <a href={`#${section.id}`}>{section.label}</a>
        {/each}
      </nav>
      <section class="docs-section" id="installation">
        <span class="docs-kicker">01 / GET STARTED</span>
        <h2>Installation</h2>
        <p>
          Agent Terminal is stable on macOS 13 and later, with Zsh as its
          daily-driver shell. Download the build for your Mac or install it
          using Homebrew.
        </p>
        <div class="docs-downloads">
          <a
            href="https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-aarch64.dmg"
            >Apple Silicon <ArrowUpRight size={14} /></a
          ><a
            href="https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-x64.dmg"
            >Intel <ArrowUpRight size={14} /></a
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
        <h3>First launch</h3>
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
            Install your preferred agent using its own setup guide, then launch
            it from the tab.
          </li>
        </ol>
        <p>
          Already have a terminal workflow? Your shell and CLI tools remain
          available. Agent Terminal adds project organization and session
          context around them.
        </p>
      </section>
      <section class="docs-section" id="projects">
        <span class="docs-kicker">02 / WORKSPACE</span>
        <h2>Projects and tabs</h2>
        <p>
          Organize related sessions under projects and switch between them
          without losing your place. Tabs remember their working directory and
          reopen there.
        </p>
        <h3>Keep context between sessions</h3>
        <p>
          Projects group tabs by the work they belong to. Each tab remembers its
          working directory, so reopening a project helps you return to the
          right place. The sidebar and tab bar give you ways to move between
          active sessions.
        </p>
        <div class="docs-callout">
          <strong>Find a recent session</strong>
          <p>
            Press <kbd>⌘</kbd> <kbd>P</kbd> to open the recent-tabs switcher.
            Type to filter and press Enter to jump back in.
          </p>
        </div>
      </section>
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
              Amp, Kilo Code, Kimi CLI, and Mastra. Detection works and is still
              being tested.
            </p>
          </div>
        </div>
        <h3>How detection works</h3>
        <p>
          Agent Terminal identifies a running agent and combines available
          signals such as lifecycle hooks, terminal titles, and process
          activity. Integration methods differ by agent: for example, Claude
          Code and Codex use native hooks, while opencode uses a session plugin.
          Amp uses terminal-title signals.
        </p>
        <p>
          Agent support is independent of provider usage in Jarvis. An installed
          CLI may still need its own sign-in, and experimental integrations may
          need further testing.
        </p>
        <a class="docs-link" href="/agents"
          >See all agent integrations <ArrowUpRight size={14} /></a
        >
      </section>
      <section class="docs-section" id="status-bar">
        <span class="docs-kicker">04 / LIVE CONTEXT</span>
        <h2>The status bar</h2>
        <p>
          The status bar follows the focused tab and refreshes its context
          regularly, so you can see what’s running without leaving the terminal.
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
      <section class="docs-section" id="jarvis">
        <span class="docs-kicker">05 / PROVIDER USAGE</span>
        <h2>Jarvis</h2>
        <p>
          Jarvis shows provider usage and reset windows. Open
          <strong>Jarvis</strong>
          from the status bar, choose
          <strong>Settings</strong>, enable it, and select the providers you
          want to track. Sources remain off until selected.
        </p>
        <p>
          Hover or focus the Jarvis button for compact gauges, or open it for
          details. Usage access depends on the enabled provider and an existing
          local session or key. Unavailable data is shown as unavailable.
        </p>
        <div class="docs-callout">
          <strong>Provider access stays opt-in</strong>
          <p>
            Credentials are read for enabled providers; Jarvis does not save
            them or send them to the frontend. It reports provider quotas, not
            estimated model spending.
          </p>
        </div>
        <h3>Reading the gauges</h3>
        <p>
          The hover panel can show a weekly outer arc and an hourly or session
          inner arc when those windows are reported. Unknown windows remain
          empty. In an agent tab, the status bar follows that agent’s available
          session allowance or account status; weekly readings remain in the
          hover panel and usage dialog.
        </p>
        <h3>Refresh and troubleshooting</h3>
        <p>
          Jarvis refreshes every five minutes by default; manual, one-minute,
          and fifteen-minute modes are also available. Use
          <strong>Refresh</strong>
          after changing credentials. If a provider session has expired, renew
          it in that provider’s CLI. Claude Code may require explicitly
          authorizing Keychain access from its usage card.
        </p>
        <p>
          Jarvis detects installed executables at startup and periodically
          thereafter. Use <strong>Rescan</strong> in Settings to check
          immediately. If an executable is not found, make sure its install
          location is available to the desktop process’s PATH.
        </p>
        <a
          class="docs-link"
          href="https://github.com/DaniAkash/agent-terminal/blob/main/docs/jarvis.md"
          target="_blank"
          rel="noreferrer"
          >Read the full Jarvis guide <ArrowUpRight size={14} /></a
        >
      </section>
      <section class="docs-section" id="mobile">
        <span class="docs-kicker">06 / COMPANION</span>
        <h2>On your phone</h2>
        <p>
          The mobile companion pairs with your desktop and lets you access your
          projects and terminal sessions from your phone. Pair a device from the
          desktop using the app’s pairing flow.
        </p>
        <h3>Pair a device</h3>
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
      <section class="docs-section" id="shortcuts">
        <span class="docs-kicker">07 / KEYBOARD</span>
        <h2>Keyboard shortcuts</h2>
        <p>Move around your workspace without leaving the keyboard.</p>
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
                <td><kbd>Ctrl</kbd> + <kbd>T</kbd></td>
              </tr>
              <tr>
                <td>Close the active tab</td>
                <td><kbd>Ctrl</kbd> + <kbd>W</kbd></td>
              </tr>
              <tr>
                <td>Cycle tabs</td>
                <td>
                  <kbd>Ctrl</kbd>
                  + <kbd>Tab</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> +
                  <kbd>Tab</kbd>
                </td>
              </tr>
              <tr>
                <td>Jump to project 1–9</td>
                <td><kbd>Ctrl</kbd> + <kbd>1</kbd> … <kbd>9</kbd></td>
              </tr>
              <tr>
                <td>Open recent-tabs switcher</td>
                <td><kbd>⌘</kbd> + <kbd>P</kbd></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="docs-section" id="platforms">
        <span class="docs-kicker">08 / COMPATIBILITY</span>
        <h2>Platforms and shells</h2>
        <p>
          Agent Terminal is daily-driven on macOS with Zsh. Other platforms and
          shells need more testing and contributions.
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
                <td>Linux</td>
                <td>Untested · contributors wanted</td>
              </tr>
              <tr>
                <td>Windows</td>
                <td>Untested · contributors wanted</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
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
        <h3>Useful development commands</h3>
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
          guide explains how profiles, hooks, plugins, and terminal signals fit
          together when adding an integration.
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
    </article>
    <aside class="docs-aside">
      <span>IN THIS GUIDE</span>
      <p>From first launch to your next contribution.</p>
      <a
        href="https://github.com/DaniAkash/agent-terminal/blob/main/README.md"
        target="_blank"
        rel="noreferrer"
        >Repository README <ArrowUpRight size={13} /></a
      >
    </aside>
  </div>
</main>
