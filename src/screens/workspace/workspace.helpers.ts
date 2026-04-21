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

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function randomSuffix(): string {
  return Math.random().toString(16).slice(2, 6)
}
