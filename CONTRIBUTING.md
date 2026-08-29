# Contributing to Agent Terminal

Thank you for your interest in contributing. Agent Terminal is in early active development — contributions, bug reports, and ideas are all welcome.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Code conventions](#code-conventions)
- [Branch and commit conventions](#branch-and-commit-conventions)
- [Pull request process](#pull-request-process)
- [Adding a new agent (agent registry)](#adding-a-new-agent-agent-registry)
- [Reporting bugs](#reporting-bugs)
- [Requesting features](#requesting-features)
- [Releasing](#releasing)

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| macOS | 13+ | — |
| Rust | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Bun | latest | `curl -fsSL https://bun.sh/install \| bash` |
| Xcode CLT | latest | `xcode-select --install` |

> **Note:** Windows support is on the roadmap but is not available yet. Development currently requires macOS.

---

## Development setup

```sh
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/agent-terminal.git
cd agent-terminal

# 2. Install frontend dependencies
bun install

# 3. Start the app in dev mode
bun run tauri:dev
```

The first build compiles the Rust backend from scratch — expect 3–5 minutes. Subsequent runs are much faster due to incremental compilation.

### Useful dev commands

```sh
bun run tauri:dev       # start app with hot-reload frontend + auto-rebuild Rust on changes
bun run lint            # run Biome (JS/TS) + Cargo Clippy (Rust)
bun run lint:fix        # auto-fix lint issues (safe fixes only)
bun run typecheck       # TypeScript type check (no emit)
bun run test            # run tests
bun run tauri:build     # production build → apps/desktop/target/release/bundle/
```

---

## Project structure

```
agent-terminal/
├── src/                        # React frontend
│   ├── components/             # Shared UI components
│   │   ├── StatusBar/          # StatusBarLeft, StatusBarRight, StatusBar
│   │   ├── Sidebar/            # SidebarProjectRow, SidebarTabItem
│   │   ├── TabBar/             # TabBar, tab pills
│   │   ├── AgentGlyph.tsx      # Brand mark + state badge for agent tabs
│   │   ├── DangerBadge.tsx     # Full-permissions indicator
│   │   └── agent.helpers.ts    # hasDangerFlag, parseModelFlag, deriveAgentState
│   ├── modules/
│   │   ├── stores/             # nanostores — $projects, $tabMeta, $navigation
│   │   ├── ipc/                # Tauri IPC command wrappers
│   │   └── mods/               # Frontend side of the MOD event system
│   └── screens/
│       └── workspace/          # Main workspace screen, types, helpers
│
├── apps/desktop/src-tauri/      # Rust backend
│   └── src/
│       ├── agents/             # Agent registry (single source of truth)
│       │   ├── mod.rs          # AgentProfile + AGENTS registry + lookups
│       │   ├── claude_code.rs  # one profile per agent (identity, hooks, OSC)
│       │   ├── codex.rs
│       │   ├── opencode.rs
│       │   └── assets/         # plugin assets for plugin-based agents
│       ├── mod_engine/         # MOD system core
│       │   ├── engine.rs       # ModEngine: wires PTY output to registered MODs
│       │   ├── context.rs      # ModContext: per-tab context passed to each MOD
│       │   └── mods/           # Individual MOD implementations
│       │       ├── agent_identity.rs  # registry-driven agent detection -> badges
│       │       ├── agent_state.rs     # fused state engine (hooks + OSC + floor)
│       │       ├── shell_process.rs   # process scan + registry-based identity
│       │       ├── process_tracker.rs
│       │       ├── dir_tracker.rs
│       │       └── git_monitor.rs
│       ├── hook_config.rs      # installs agent hooks/plugins from the registry
│       ├── pty_manager.rs      # PTY lifecycle (spawn, write, resize, close)
│       ├── shell_integration.rs # Writes OSC 7 / OSC 133 shell hook scripts
│       └── commands.rs         # Tauri IPC command handlers
```

---

## Code conventions

### TypeScript / React

- **Formatter + linter:** [Biome](https://biomejs.dev) — run `bun run lint` before opening a PR
- **Imports:** always use `@/` path alias (never relative `../../`)
- **Components:** PascalCase `.tsx` files; supporting files use the satellite naming pattern:
  - `feature.helpers.ts` — pure functions, no React
  - `feature.hooks.ts` — custom React hooks
  - `feature.types.ts` — TypeScript types
- **State:** nanostores in `modules/stores/` prefixed with `$` (e.g. `$tabMeta`)
- **No biome-ignore comments:** fix lint issues properly; never suppress them
- **Cognitive complexity:** keep functions under Biome's limit (15); extract helpers when needed

### Rust

- **Formatter:** `rustfmt` (runs automatically in most editors with rust-analyzer)
- **Linter:** Clippy — run `bun run lint:rust` or `cargo clippy --all-targets`
- **No `unwrap()` in production paths** — use `?` or handle errors explicitly
- **MODs own their per-tab state** (allocate in `on_open`, drop in `on_close`); most agent work is data in the registry, see [Adding a new agent](#adding-a-new-agent-agent-registry) below

---

## Branch and commit conventions

Branch names follow [Conventional Branch](https://conventional-branch.github.io/):

```
feat/my-feature-name
fix/bug-description
docs/update-readme
refactor/mod-system-cleanup
chore/bump-deps
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(status-bar): add memory usage display
fix(mod): correct port detection for IPv6 listeners
docs(contributing): add MOD system guide
refactor(sidebar): extract project row into separate component
chore: update tauri to 2.1.0
```

---

## Pull request process

1. **Fork** the repo and create your branch from `main`
2. **Make your changes** — keep PRs focused; one feature or fix per PR
3. **Run checks locally** before pushing:
   ```sh
   bun run lint
   bun run typecheck
   bun run test
   ```
4. **Open a PR** against `main` with a clear description of what changed and why
5. **Link any related issues** in the PR description
6. A maintainer will review and merge — please be patient during early development

---

## Adding a new agent (agent registry)

Agent support is declarative. A single registry in `apps/desktop/src-tauri/src/agents/` is the source of truth for how each agent is identified, how its hook integration is installed, and how its live state is detected. Identity detection, hook installation, and OSC state detection all read the registry, so adding an agent is mostly one profile entry plus (for plugin-based agents) one plugin asset. There is no per-agent MOD to write and no `lib.rs` change.

How the state engine works, in one paragraph: each agent tab gets a fused state from three signals. **Hooks** (the agent's own lifecycle events, POSTed to a local server) give precise transitions. **OSC** (the agent's window title / progress) corrects a stale hook for agents that emit it. An agent-agnostic **process/prompt floor** (process liveness plus shell-prompt return) releases any stuck state back to idle, so a missed hook never leaves a badge stuck. You supply the per-agent facts; the engine does the fusing.

### Step 1: add an agent profile

Create `apps/desktop/src-tauri/src/agents/<agent>.rs` and register it in `AGENTS` in `apps/desktop/src-tauri/src/agents/mod.rs`:

```rust
use super::{AgentProfile, EventRole, HookEvent, HookInstall, HookSpec};

static EVENTS: &[HookEvent] = &[
    HookEvent { name: "SessionStart", role: EventRole::SessionStart },
    HookEvent { name: "UserPromptSubmit", role: EventRole::Working },
    HookEvent { name: "Stop", role: EventRole::Completed },
];

pub static PROFILE: AgentProfile = AgentProfile {
    id: "my-agent",               // stable id used on the hook wire and as the frontend agent_id
    display_name: "My Agent",
    process_names: &["my-agent"], // foreground process basename(s) that identify this agent
    runtime_wrapped: false,       // true if it runs under node/bun/python (identity then walks argv)
    hook: Some(HookSpec {
        install: HookInstall::NativeConfig { config_tilde_path: "~/.my-agent/settings.json" },
        events: EVENTS,
        timeout_ms: 5_000,
    }),
    osc: None,                    // Some(fn) if the agent reports state via its OSC title/progress
};
```

Then wire it into the registry in `agents/mod.rs`:

```rust
pub mod my_agent;

pub static AGENTS: &[&AgentProfile] = &[
    // ... existing profiles ...
    &my_agent::PROFILE,
];
```

That alone makes identity detection and hook install pick up the agent.

### Step 2: choose how the hook installs

Map each hook event name to an `EventRole` (`SessionStart`, `Working`, `Blocked`, `Completed`, `SessionEnd`). The engine is role-driven, so an agent can use whatever event names it emits. Pick the install kind:

- **`HookInstall::NativeConfig`** for agents with their own hooks settings file (like Claude's `~/.claude/settings.json`). Agent Terminal merges its hook command in non-destructively, preserving existing entries.
- **`HookInstall::Plugin`** for agents that load plugins from a directory (like opencode's `~/.config/opencode/plugin/`). Add a fresh plugin asset under `apps/desktop/src-tauri/src/agents/assets/` and reference it with `include_str!`. The plugin POSTs `{ "agent", "event", "tab_id", "session_id"? }` to the local hook server; the hook port is provided to the shell as `AGENT_TERMINAL_HOOK_PORT` and the tab id as `AGENT_TERMINAL_TAB_ID`. Omit `session_id` when unknown (never send an empty string).

An agent with no hook at all is fine too (`hook: None`): it is still detected by process name and gets working/idle from the floor.

### Step 3: OSC state signature (optional)

If the agent paints its state into the terminal title or progress (like Claude's Braille spinner glyph), add a pure function and set `osc: Some(...)`:

```rust
use super::{is_braille, OscState, OscView};

fn state_from_osc(view: &OscView) -> Option<OscState> {
    if view.title.trim_start().chars().next().is_some_and(is_braille) {
        return Some(OscState::Working);
    }
    // ... your idle / blocked signals ...
    None
}
```

This corrects a stale hook without any screen scraping. Reference the agent's actual title output; do not scrape arbitrary screen text.

### Step 4: frontend glyph

In `src/components/AgentGlyph.tsx`, add the agent's `id` to `BRAND` (color + glow) and `MARKS` (a small SVG brand-mark component that renders at ~10-16px):

```tsx
const BRAND: Record<string, { color: string; glow: string }> = {
  // ... existing ...
  'my-agent': { color: '#4285F4', glow: 'rgba(66,133,244,0.45)' },
}

const MARKS: Record<string, React.ComponentType<{ size: number }>> = {
  // ... existing ...
  'my-agent': MyAgentMark,
}
```

This is optional: unknown agents fall back to a generic sparkle glyph. If the agent has a full-permissions flag, add it to `hasDangerFlag` in `src/components/agent.helpers.ts`.

### Step 5: test

Add unit tests next to your profile (identity resolution, and the OSC signature if present), then:

```sh
cargo test --manifest-path apps/desktop/Cargo.toml --lib -- agents::
bun run tauri:dev
```

Launch the agent in a tab and verify the badge cycles idle -> in-progress -> awaiting -> completed. Then kill the agent mid-turn (Ctrl-C or close the pane) and confirm the badge returns to idle within a couple seconds rather than sticking. That is the floor doing its job.

---

## Reporting bugs

Open an issue on GitHub with:
- macOS version and chip (Apple Silicon / Intel)
- Agent Terminal version
- Steps to reproduce
- What you expected vs what happened
- Logs from the app (Help → Show Logs, if available) or the Tauri dev console

---

## Requesting features

- **New agent support:** [request on X →](https://x.com/dani_akash_)
- **Other features:** open a GitHub issue with the `enhancement` label and describe your use case

---

## Releasing

Releases are tag-triggered. Pushing a `vX.Y.Z` (or `vX.Y.Z-rc.N`) tag fires the workflow, which builds, signs, and notarizes per-arch `.dmg`s in parallel, attaches them plus the updater bundles to a draft GitHub release, and publishes the updater manifest to the `release-manifest` branch.

### Cutting a release

1. **Bump the version** in three places so the tag matches the bundle metadata:
   - `package.json`
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `apps/desktop/Cargo.toml`

   Then refresh `apps/desktop/Cargo.lock` (`cargo update -p agent-terminal`) and open a PR titled `chore(release): vX.Y.Z`. The `chore(release)` prefix is filtered out of the next changelog.

2. **Merge the bump PR**, then tag and push:

   ```sh
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. **Wait for the workflow** (~10 min). When it finishes, a draft release appears on the [releases page](https://github.com/DaniAkash/agent-terminal/releases) with:
   - 2× `Agent.Terminal_<version>_{aarch64,x64}.dmg` (versioned)
   - 2× `agent-terminal-{aarch64,x64}.dmg` (stable filenames for the README's `/releases/latest/download/` badges)
   - 2× `Agent.Terminal_{aarch64,x64}.app.tar.gz` + `.sig` (updater payloads)
   - 1× `latest.json` (manifest copy)

4. **Write the release notes** following the v0.1.x style: headline emoji, "Still pre-release" banner, **What's new** with feature blurbs, **Install** with both badge links, **Still on the heads-up list**, optional **Thanks**, **Feedback**.

5. **Publish**, and:
   - **Tick "Set as the latest release"** even if you're also ticking "Set as pre-release". This is required for `/releases/latest/download/` to redirect to this release — GitHub treats "latest" and "prerelease" as independent flags, but the `/latest/` redirect is off by default for pre-releases unless you opt in.
   - Verify the README badges actually resolve: `curl -ILo /dev/null https://github.com/DaniAkash/agent-terminal/releases/latest/download/agent-terminal-aarch64.dmg` should redirect to the new asset.

6. **Verify `latest.json`** at `https://raw.githubusercontent.com/DaniAkash/agent-terminal/release-manifest/latest.json` reflects the new version (cached ~5 min by raw.githubusercontent.com). Installed apps see the update on their next launch, or immediately via **Agent Terminal → Check for Updates…**.

### Test tags

For dry-runs (e.g., verifying a workflow change), push a `vX.Y.Z-rc.N` tag on a throwaway branch. The workflow treats it the same as a real release — full build, signing, notarization, draft release, manifest publish. Just don't publish the draft and don't tick "Set as latest"; delete the tag and draft afterwards if you want a clean releases page.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
