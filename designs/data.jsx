// Fake project + tab data, plus terminal scripts

const PROJECTS = [
  {
    id: 'claude-ui',
    name: 'claude-ui',
    path: '~/work/claude-ui',
    tabs: [
      { id: 'dev',    label: 'dev',    cmd: 'pnpm dev',         script: 'nextDev',    running: true  },
      { id: 'server', label: 'server', cmd: 'node server.mjs',  script: 'nodeServer', running: true  },
      { id: 'git',    label: 'git',    cmd: 'git status',       script: 'gitStatus',  running: false },
      { id: 'repl',   label: 'repl',   cmd: 'node',             script: 'nodeRepl',   running: true  },
    ],
  },
  {
    id: 'api-service',
    name: 'api-service',
    path: '~/work/api-service',
    tabs: [
      { id: 'dev',  label: 'dev',  cmd: 'cargo watch -x run', script: 'cargoWatch', running: true  },
      { id: 'db',   label: 'db',   cmd: 'psql billing_dev',   script: 'psql',       running: true  },
      { id: 'logs', label: 'logs', cmd: 'tail -f app.log',    script: 'tailLog',    running: true  },
    ],
  },
  {
    id: 'dotfiles',
    name: 'dotfiles',
    path: '~/.dotfiles',
    tabs: [
      { id: 'shell', label: 'shell', cmd: 'zsh', script: 'idleShell', running: false },
    ],
  },
  {
    id: 'notes',
    name: 'field-notes',
    path: '~/notes',
    tabs: [
      { id: 'edit', label: 'edit', cmd: 'nvim today.md', script: 'idleShell', running: false },
    ],
  },
];

// ────────────────────────────────────────────────────────────
// Scripts: ordered array of lines. Each line has:
//   { text, color?, delay?, typed? }
// `typed: true` means user-typed (shown after prompt, keystroke animation)
// Others stream in as output.
// ────────────────────────────────────────────────────────────
const SCRIPTS = {
  nextDev: {
    prompt: 'claude-ui',
    cwd: '~/work/claude-ui',
    lines: [
      { typed: true, text: 'pnpm dev' },
      { text: '', delay: 200 },
      { text: '> claude-ui@0.8.2 dev', color: 'dim', delay: 150 },
      { text: '> next dev --turbo -p 3000', color: 'dim', delay: 120 },
      { text: '', delay: 200 },
      { text: '  ▲ Next.js 15.2.1 (turbo)', color: 'text', delay: 280 },
      { text: '  - Local:   http://localhost:3000', color: 'dim', delay: 120 },
      { text: '  - Network: http://10.0.1.42:3000', color: 'dim', delay: 60 },
      { text: '', delay: 200 },
      { text: ' ✓ Ready in 812ms', color: 'green', delay: 420 },
      { text: ' ✓ Compiled / in 1.2s (892 modules)', color: 'green', delay: 900 },
      { text: ' ○ Compiling /api/chat ...', color: 'yellow', delay: 1400 },
      { text: ' ✓ Compiled /api/chat in 380ms (24 modules)', color: 'green', delay: 900 },
      { text: ' GET / 200 in 34ms', color: 'dim', delay: 800 },
      { text: ' GET /api/chat 200 in 112ms', color: 'dim', delay: 700 },
      { text: ' GET /_next/static/chunks/webpack.js 200 in 8ms', color: 'dim', delay: 500 },
      { text: ' POST /api/chat 200 in 842ms', color: 'dim', delay: 1600 },
      { text: ' GET /settings 200 in 28ms', color: 'dim', delay: 900 },
      { text: ' POST /api/chat 200 in 612ms', color: 'dim', delay: 1300 },
    ],
  },
  nodeServer: {
    prompt: 'claude-ui',
    cwd: '~/work/claude-ui',
    lines: [
      { typed: true, text: 'node server.mjs' },
      { text: '', delay: 150 },
      { text: '[server] booting…', color: 'dim', delay: 200 },
      { text: '[server] listening on :4000', color: 'green', delay: 400 },
      { text: '[ws] client connected  id=a8f2', color: 'cyan', delay: 1100 },
      { text: '[ws] → subscribe: session/42', color: 'dim', delay: 700 },
      { text: '[ws] ← message 64b', color: 'dim', delay: 1400 },
      { text: '[ws] ← message 128b', color: 'dim', delay: 900 },
      { text: '[ws] client connected  id=b1c7', color: 'cyan', delay: 1600 },
    ],
  },
  gitStatus: {
    prompt: 'claude-ui',
    cwd: '~/work/claude-ui',
    lines: [
      { typed: true, text: 'git status' },
      { text: 'On branch feat/reattach-sessions', color: 'text', delay: 120 },
      { text: "Your branch is ahead of 'origin/feat/reattach-sessions' by 2 commits.", color: 'dim', delay: 80 },
      { text: '', delay: 60 },
      { text: 'Changes not staged for commit:', color: 'text', delay: 80 },
      { text: '  modified:   src/terminal/pty.ts', color: 'red', delay: 60 },
      { text: '  modified:   src/sidebar/Tree.tsx', color: 'red', delay: 60 },
      { text: '', delay: 60 },
      { text: 'Untracked files:', color: 'text', delay: 80 },
      { text: '  src/terminal/reattach.ts', color: 'red', delay: 60 },
      { text: '', delay: 60 },
      { typed: true, text: 'git diff --stat', delay: 1200 },
      { text: ' src/terminal/pty.ts     | 42 +++++++++++++++---', color: 'text', delay: 120 },
      { text: ' src/sidebar/Tree.tsx    |  8 +++--', color: 'text', delay: 60 },
      { text: ' 2 files changed, 46 insertions(+), 4 deletions(-)', color: 'dim', delay: 80 },
    ],
  },
  nodeRepl: {
    prompt: 'claude-ui',
    cwd: '~/work/claude-ui',
    lines: [
      { typed: true, text: 'node' },
      { text: 'Welcome to Node.js v22.3.0.', color: 'dim', delay: 200 },
      { text: 'Type ".help" for more information.', color: 'dim', delay: 80 },
      { text: '> ', color: 'prompt', delay: 400, inline: true },
      { typed: true, text: 'const users = await db.users.findMany()', delay: 600, replPrompt: true },
      { text: 'undefined', color: 'magenta', delay: 300 },
      { typed: true, text: 'users.length', delay: 900, replPrompt: true },
      { text: '247', color: 'yellow', delay: 200 },
      { typed: true, text: "users.filter(u => u.plan === 'pro').length", delay: 1100, replPrompt: true },
      { text: '58', color: 'yellow', delay: 200 },
    ],
  },
  cargoWatch: {
    prompt: 'api-service',
    cwd: '~/work/api-service',
    lines: [
      { typed: true, text: 'cargo watch -x run' },
      { text: '[Running `cargo run`]', color: 'dim', delay: 150 },
      { text: '   Compiling api-service v0.3.1', color: 'text', delay: 400 },
      { text: '    Finished dev [unoptimized] target(s) in 2.84s', color: 'green', delay: 1800 },
      { text: '     Running `target/debug/api-service`', color: 'dim', delay: 300 },
      { text: '', delay: 100 },
      { text: '  INFO api_service: 🦀 listening on 0.0.0.0:8080', color: 'green', delay: 200 },
      { text: '  INFO api_service::db: connected pool=10', color: 'cyan', delay: 400 },
      { text: '  INFO api_service::http: GET /v1/health 200 2ms', color: 'dim', delay: 1400 },
      { text: '  INFO api_service::http: POST /v1/sessions 201 34ms', color: 'dim', delay: 1100 },
      { text: '  INFO api_service::http: GET /v1/sessions/42 200 8ms', color: 'dim', delay: 900 },
      { text: '  WARN api_service::auth: token nearing expiry user=usr_a8f2', color: 'yellow', delay: 1400 },
      { text: '  INFO api_service::http: POST /v1/auth/refresh 200 12ms', color: 'dim', delay: 800 },
    ],
  },
  psql: {
    prompt: 'api-service',
    cwd: '~/work/api-service',
    lines: [
      { typed: true, text: 'psql billing_dev' },
      { text: 'psql (16.2)', color: 'dim', delay: 120 },
      { text: 'Type "help" for help.', color: 'dim', delay: 80 },
      { text: '', delay: 100 },
      { typed: true, text: 'select count(*) from invoices where paid = false;', delay: 800, replPrompt: 'billing_dev=#' },
      { text: ' count ', color: 'text', delay: 120 },
      { text: '-------', color: 'dim', delay: 40 },
      { text: '    14', color: 'yellow', delay: 60 },
      { text: '(1 row)', color: 'dim', delay: 80 },
    ],
  },
  tailLog: {
    prompt: 'api-service',
    cwd: '~/work/api-service',
    lines: [
      { typed: true, text: 'tail -f app.log' },
      { text: '2026-04-18T14:02:11Z  INFO  request.start method=GET path=/v1/me', color: 'dim', delay: 300 },
      { text: '2026-04-18T14:02:11Z  INFO  request.end   status=200 dur=12ms', color: 'dim', delay: 400 },
      { text: '2026-04-18T14:02:12Z  INFO  request.start method=POST path=/v1/webhooks/stripe', color: 'dim', delay: 700 },
      { text: '2026-04-18T14:02:12Z  INFO  stripe.event  type=invoice.paid id=evt_1NH..', color: 'cyan', delay: 400 },
      { text: '2026-04-18T14:02:12Z  INFO  request.end   status=200 dur=84ms', color: 'dim', delay: 200 },
      { text: '2026-04-18T14:02:14Z  WARN  ratelimit     user=usr_7f22 hit=1.2x', color: 'yellow', delay: 1200 },
      { text: '2026-04-18T14:02:16Z  INFO  request.start method=GET path=/v1/invoices', color: 'dim', delay: 900 },
      { text: '2026-04-18T14:02:16Z  INFO  request.end   status=200 dur=31ms', color: 'dim', delay: 300 },
    ],
  },
  idleShell: {
    prompt: 'shell',
    cwd: '~/.dotfiles',
    lines: [
      { typed: true, text: 'ls' },
      { text: 'README.md    install.sh   nvim/        zsh/', color: 'cyan', delay: 120 },
      { typed: true, text: 'git log --oneline -5', delay: 1000 },
      { text: 'a8f2b10  tweak ghostty config', color: 'yellow', delay: 60 },
      { text: '7c19e42  add tmux status line', color: 'yellow', delay: 40 },
      { text: '3d0c8a1  switch to zsh-autosuggestions', color: 'yellow', delay: 40 },
      { text: 'b2e1f77  nvim: enable inlay hints', color: 'yellow', delay: 40 },
      { text: '9ac4552  init', color: 'yellow', delay: 40 },
    ],
  },
};

Object.assign(window, { PROJECTS, SCRIPTS });
