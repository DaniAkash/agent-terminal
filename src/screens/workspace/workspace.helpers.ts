import type { Project } from './workspace.types'

export const SEED_PROJECTS: Project[] = [
  {
    id: 'claude-ui',
    name: 'claude-ui',
    path: '~/work/claude-ui',
    pinned: false,
    tabs: [
      {
        id: 'dev',
        label: 'dev',
        cmd: 'pnpm dev',
        running: true,
        pinned: false,
      },
      {
        id: 'server',
        label: 'server',
        cmd: 'node server.mjs',
        running: true,
        pinned: false,
      },
      {
        id: 'git',
        label: 'git',
        cmd: 'git status',
        running: false,
        pinned: false,
      },
      { id: 'repl', label: 'repl', cmd: 'node', running: true, pinned: false },
    ],
  },
  {
    id: 'api-service',
    name: 'api-service',
    path: '~/work/api-service',
    pinned: false,
    tabs: [
      {
        id: 'dev',
        label: 'dev',
        cmd: 'cargo watch -x run',
        running: true,
        pinned: false,
      },
      {
        id: 'db',
        label: 'db',
        cmd: 'psql billing_dev',
        running: true,
        pinned: false,
      },
      {
        id: 'logs',
        label: 'logs',
        cmd: 'tail -f app.log',
        running: true,
        pinned: false,
      },
    ],
  },
  {
    id: 'dotfiles',
    name: 'dotfiles',
    path: '~/.dotfiles',
    pinned: false,
    tabs: [
      {
        id: 'shell',
        label: 'shell',
        cmd: 'zsh',
        running: false,
        pinned: false,
      },
    ],
  },
]

export const MONO_FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace'

export function makeTabKey(projectId: string, tabId: string): string {
  return `${projectId}:${tabId}`
}

export function dedupeLabel(existing: string[], base = 'shell'): string {
  let label = base
  let n = 2
  const set = new Set(existing)
  while (set.has(label)) label = `${base} ${n++}`
  return label
}
