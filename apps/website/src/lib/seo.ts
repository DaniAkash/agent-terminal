export const SITE_URL = 'https://agent-terminal.org'
export const SITE_NAME = 'Agent Terminal'
export const pages: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Agent Terminal — The Terminal for AI Coding Agents',
    description:
      'An open-source terminal workspace for AI coding agents. Organize projects and follow agent sessions on macOS and Linux.',
  },
  '/downloads': {
    title: 'Download Agent Terminal for macOS and Linux',
    description:
      'Download Agent Terminal for macOS or Linux. Find the latest GitHub release, Apple Silicon and Intel builds, AppImage, Debian and RPM packages.',
  },
  '/agents': {
    title: 'Supported AI Coding Agents — Agent Terminal',
    description:
      'Explore Agent Terminal integrations for Claude Code, Codex, opencode, and more, including support status, launch commands, and setup guides.',
  },
  '/docs': {
    title: 'Documentation — Agent Terminal',
    description:
      'Install Agent Terminal and learn about project workspaces, coding agents, the status bar, Agent Usage limits, mobile pairing, and keyboard shortcuts.',
  },
  '/changelog': {
    title: 'Changelog and Releases — Agent Terminal',
    description:
      'Follow Agent Terminal releases, features, and fixes in a changelog sourced from the project’s GitHub releases.',
  },
}
