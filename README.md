# Agent Terminal

> A mouse-first, project-scoped terminal workspace built for running AI coding agents effectively.

**⚠️ Early stage — under heavy active development. APIs and UI will change.**

---

## What is Agent Terminal?

Agent Terminal is a native macOS terminal app designed around the way developers actually work with AI coding agents today: multiple projects, multiple agents, multiple sessions — all running simultaneously and all needing context at a glance.

Most terminals treat every tab equally. Agent Terminal gives each project its own workspace, tracks your AI agent sessions as first-class citizens, and surfaces live runtime metadata — memory usage, listening ports, model in use, git state — directly in the status bar without you having to switch windows or run commands.

It is built on [Tauri](https://tauri.app) (Rust backend, WebView frontend) and uses [xterm.js](https://xtermjs.org) for terminal rendering. There are no config files to edit and no tmux dependency — just open it and use it.

---

## Features

### Project-scoped workspaces
Tabs are organized under named projects. Switch between projects without losing your place. Each tab remembers its working directory and restores it on the next launch.

### AI agent integration
Agent Terminal detects when an AI coding agent is running inside a tab and surfaces agent-specific context automatically — no manual setup required.

Supported agents:

| Agent | Status |
|-------|--------|
| [Claude Code](https://claude.ai/code) | ✅ Supported |
| [Codex CLI](https://github.com/openai/codex) | ✅ Supported |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | 🔜 Planned |
| [Cursor](https://www.cursor.com) | 🔜 Planned |
| [Open Code](https://github.com/sst/opencode) | 🔜 Planned |

Want support for another agent? [Request it on X →](https://x.com/dani_akash_)

### Live status bar
The status bar shows real-time context for the active tab, updated every 2 seconds.

**Left side** — workspace overview (global across all projects):
- Active agents running · Active shell tasks · Failed tasks

**Right side** — active tab context:
- Process name · PID · ⏱ elapsed · 🧮 memory (RSS)
- 🔌 Listening TCP ports (so you know when your dev server is up)
- ✨ `--model` flag when an agent is running with a specific model
- ⎇ Git branch · dirty indicator · commits ahead/behind remote
- 📂 Current working directory (hover to see full path)

### Agent glyph system
Each agent tab shows a brand mark (Anthropic sunburst for Claude, OpenAI hex for Codex) in the tab bar and sidebar that reflects the session state. When an agent is running with full permissions (`--dangerously-skip-permissions` for Claude Code, `--yolo` for Codex), a danger badge appears next to the tab.

### MOD system
The intelligence layer is built on a Rust-native MOD system. Each MOD subscribes to PTY output and shell hook events, extracts structured data, and emits it to the frontend — without blocking the terminal or adding visible latency.

| MOD | What it does |
|-----|-------------|
| `DirTrackerMod` | Tracks CWD via OSC 7 shell hooks |
| `ProcessTrackerMod` | Tracks process state (running / done / error) via OSC 133 |
| `ClaudeCodeMod` | Detects Claude Code sessions, extracts `--model` and permission flags |
| `CodexMod` | Detects Codex sessions, extracts permission flags |
| `ProcessInspectorMod` | Polls live process metrics: PID, RSS memory, elapsed time, TCP ports |
| `GitMonitorMod` | Tracks git branch, dirty state, and remote sync status |

### No tmux dependency
Sessions use raw PTYs managed directly by Rust. No tmux, no daemon, no invisible infrastructure. The tradeoff: long-running processes need to be restarted when you reopen the app. In exchange, the app is simpler, faster to start, and has zero external dependencies.

### Universal binary
Ships as a universal macOS binary — a single app that runs natively on both Apple Silicon and Intel Macs.

---

## Screenshots

> Screenshots and a demo video are coming. Check back soon or follow [@dani_akash_](https://x.com/dani_akash_) for updates.

---

## Getting Started

### Prerequisites

- macOS 13 or later (Apple Silicon or Intel)
- [Rust](https://rustup.rs) stable toolchain
- [Bun](https://bun.sh) — `curl -fsSL https://bun.sh/install | bash`
- Xcode Command Line Tools — `xcode-select --install`

### Run in development

```sh
git clone https://github.com/DaniAkash/agent-terminal.git
cd agent-terminal

bun install
bun run tauri:dev
```

The first run compiles the Rust backend — expect a few minutes. Subsequent runs are much faster thanks to incremental compilation.

### Build for production

```sh
bun run tauri:build
```

Outputs a `.dmg` and `.app` in `src-tauri/target/release/bundle/`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| App framework | [Tauri v2](https://tauri.app) |
| Terminal rendering | [xterm.js](https://xtermjs.org) (WebGL renderer) |
| PTY backend | [portable-pty](https://github.com/wez/wezterm/tree/main/pty) (Rust) |
| Frontend | React · TypeScript · Vite |
| Styling | Tailwind CSS |
| UI components | shadcn/ui (base-ui primitives) |
| State management | [nanostores](https://github.com/nanostores/nanostores) |
| Package manager | [Bun](https://bun.sh) |
| Linter / formatter | [Biome](https://biomejs.dev) (JS) · Clippy (Rust) |

---

## Roadmap

Agent Terminal is early stage and under heavy active development.

- [x] Project-scoped workspaces with persistent tabs
- [x] xterm.js terminal with WebGL rendering
- [x] CWD tracking and tab label from working directory
- [x] OSC 133 shell integration (process state tracking)
- [x] MOD system (Rust-native plugin architecture)
- [x] Claude Code + Codex detection and agent glyphs
- [x] Live status bar (process metrics, git, CWD, icons)
- [ ] Keyboard shortcuts (Cmd+T, Cmd+W, Cmd+1–9, and more)
- [ ] Theming support (light / dark / custom color schemes)
- [ ] Gemini CLI, Cursor, Open Code agent support
- [ ] Agent turn detection (know when an agent is actively working vs idle)
- [ ] macOS App Store distribution
- [ ] Windows support

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions, code conventions, and how to add support for new agents via the MOD system.

---

## License

MIT — see [LICENSE](./LICENSE).

Copyright © 2026 [Dani Akash](https://github.com/DaniAkash). If you use or build on this project, the copyright notice must be retained as required by the MIT License.
