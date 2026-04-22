# Contributing to Agent Terminal

Thank you for your interest in contributing. Agent Terminal is in early active development — contributions, bug reports, and ideas are all welcome.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Code conventions](#code-conventions)
- [Branch and commit conventions](#branch-and-commit-conventions)
- [Pull request process](#pull-request-process)
- [Adding a new agent (MOD system guide)](#adding-a-new-agent-mod-system-guide)
- [Reporting bugs](#reporting-bugs)
- [Requesting features](#requesting-features)

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
bun run tauri:build     # production build → src-tauri/target/release/bundle/
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
├── src-tauri/                  # Rust backend
│   └── src/
│       ├── mod_engine/         # MOD system core
│       │   ├── engine.rs       # ModEngine — wires PTY output to registered MODs
│       │   ├── context.rs      # ModContext — shared state passed to each MOD
│       │   └── mods/           # Individual MOD implementations
│       │       ├── dir_tracker.rs
│       │       ├── process_tracker.rs
│       │       ├── claude_code.rs
│       │       ├── codex.rs
│       │       ├── process_inspector.rs
│       │       └── git_monitor.rs
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
- **MODs must be stateless** — see [Adding a new agent](#adding-a-new-agent-mod-system-guide) below

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

## Adding a new agent (MOD system guide)

The MOD system is how Agent Terminal learns about what's running in a terminal tab. Each MOD is a Rust struct that receives PTY output line-by-line and emits structured events to the frontend.

Adding support for a new agent (e.g. Gemini CLI) requires changes in two places: **Rust** (detection + data extraction) and **TypeScript** (display).

### Step 1 — Create the Rust MOD

Create `src-tauri/src/mod_engine/mods/<agent_name>.rs`.

A MOD implements the `TerminalMod` trait:

```rust
use crate::mod_engine::{ModContext, TerminalMod};

pub struct GeminiMod;

impl GeminiMod {
    pub fn new() -> Self { Self }
}

impl TerminalMod for GeminiMod {
    fn on_line(&self, line: &str, ctx: &ModContext) {
        // Called for every line of PTY output.
        // Detect when the agent process starts by matching its launch output.
        // Use ctx.emit() to send structured events to the frontend.
    }

    fn on_process_start(&self, cmd: &str, ctx: &ModContext) {
        // Called when a new process starts in the tab.
        // Check if cmd contains the agent binary name.
        if cmd.contains("gemini") {
            ctx.emit("tab_type_changed", serde_json::json!({
                "tabId": ctx.tab_id(),
                "type": "agent",
                "agentName": "gemini",
                "agentCmd": cmd,
            }));
        }
    }
}
```

**Key rules for MODs:**
- **Stateless** — MODs must not store mutable state between calls. All state lives in `ModContext` or is emitted to the frontend.
- **Non-blocking** — `on_line` is called synchronously on the PTY output thread. Never perform I/O or sleep inside a MOD.
- **Emit, don't act** — MODs observe and report; they never write to the PTY.

### Step 2 — Register the MOD

In `src-tauri/src/lib.rs`, add your MOD to the engine builder:

```rust
use mod_engine::mods::GeminiMod;

let mod_engine = ModEngine::builder()
    // ... existing mods ...
    .with_mod(GeminiMod::new())
    .build();
```

Also export it from `src-tauri/src/mod_engine/mods/mod.rs`:

```rust
mod gemini;
pub use gemini::GeminiMod;
```

### Step 3 — Add the frontend agent glyph

In `src/components/AgentGlyph.tsx`, add the new agent to the `BRAND` and `MARKS` maps:

```tsx
// BRAND: color + glow for the state ring
const BRAND: Record<string, { color: string; glow: string }> = {
  'claude-code': { color: '#D97757', glow: 'rgba(217,119,87,0.55)' },
  'codex':       { color: '#e6e8eb', glow: 'rgba(230,232,235,0.45)' },
  'gemini':      { color: '#4285F4', glow: 'rgba(66,133,244,0.45)' }, // ← add
}

// MARKS: SVG brand mark component — must stay in sync with BRAND
const MARKS: Record<string, React.ComponentType<{ size: number }>> = {
  'claude-code': ClaudeMark,
  'codex':       CodexMark,
  'gemini':      GeminiMark, // ← add your SVG mark component
}
```

Create `GeminiMark` as a small SVG component using the agent's brand icon. Keep it simple — the mark renders at 10–16px.

### Step 4 — Handle the danger flag (if applicable)

If the agent has a "full permissions" flag (like `--dangerously-skip-permissions` for Claude Code), add it to `hasDangerFlag` in `src/components/agent.helpers.ts`:

```ts
export function hasDangerFlag(agentCmd: string | undefined): boolean {
  if (!agentCmd) return false
  return (
    agentCmd.includes('--dangerously-skip-permissions') ||
    agentCmd.includes('--yolo') ||
    agentCmd.includes('--your-new-flag')  // ← add
  )
}
```

### Step 5 — Test

Run the app with `bun run tauri:dev`, open a terminal tab, and launch the agent. Verify:
- The tab type changes to `agent` (sidebar shows the glyph)
- The status bar right side shows the process info
- The danger badge appears when the permission flag is used

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

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
