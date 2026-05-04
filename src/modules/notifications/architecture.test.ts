/**
 * Architecture conformance test for the notification service.
 *
 * The whole point of this module is that it is **agent-agnostic** —
 * adding a new per-agent mod (Gemini, Aider, anything) must work without
 * touching any file under `src/modules/notifications/`. To prevent
 * accidental coupling from creeping back in via a future PR, this test
 * scans the notification source files for forbidden patterns:
 *
 * - Hardcoded agent IDs like "claude-code" / "codex"
 * - Lookup-table function names like `humanizeAgentName`
 * - Display-name maps like `AGENT_DISPLAY_NAMES`
 *
 * If this test fails, do NOT add the agent ID to a switch / map here.
 * Push the variability into the per-agent mod (so it emits the value on
 * the event) or into the registry (`AGENT_HOOK_CONFIGS`).
 */

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const NOTIFICATIONS_DIR = join(import.meta.dir)

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      out.push(...listSourceFiles(full))
      continue
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue
    // Skip the test files themselves — they intentionally use agent IDs
    // as test fixtures. The architectural constraint is on the runtime
    // sources, not the tests.
    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue
    out.push(full)
  }
  return out
}

const FORBIDDEN = [
  // Specific agent IDs — runtime code must NOT branch on these.
  /\bclaude-code\b/,
  /\bcodex\b/,
  // Patterns that smell like an agent_id → name map.
  /\bAGENT_DISPLAY_NAMES\b/,
  /\bhumanizeAgentName\b/,
  /\bKNOWN_AGENT_IDS?\b/,
  /\bSUPPORTED_AGENTS?\b/,
]

/**
 * Strip comments (and only comments) from TypeScript source. Doc comments
 * legitimately discuss the architecture — we want the lint to catch agent
 * IDs in *runtime code*, not in prose explaining why they aren't allowed.
 *
 * Naive but adequate: removes /* … *\/ block comments and // … line
 * comments. Doesn't try to parse strings — if any forbidden pattern is
 * inside a string literal that's almost certainly a smell anyway.
 */
function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '')
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  return out
}

type Violation = { file: string; pattern: string; sample: string }

function violationsInFile(file: string): Violation[] {
  const raw = readFileSync(file, 'utf8')
  const code = stripComments(raw)
  const lines = code.split('\n')
  const out: Violation[] = []
  for (const pattern of FORBIDDEN) {
    const match = code.match(pattern)
    if (!match) continue
    // Find the line for a more useful error — search in the
    // comments-stripped form so the lint points at runtime code.
    const lineIdx = lines.findIndex((l) => pattern.test(l))
    const sample = lineIdx >= 0 ? (lines[lineIdx] ?? '').trim() : match[0]
    out.push({
      file: file.replace(NOTIFICATIONS_DIR, '<notifications>'),
      pattern: String(pattern),
      sample,
    })
  }
  return out
}

describe('notifications module — agent-agnosticism guard', () => {
  test('no runtime source file mentions specific agent IDs or lookup tables', () => {
    const files = listSourceFiles(NOTIFICATIONS_DIR)
    expect(files.length).toBeGreaterThan(0) // sanity

    const violations = files.flatMap(violationsInFile)

    if (violations.length > 0) {
      const report = violations
        .map(
          (v) =>
            `\n  ${v.file}\n    matches ${v.pattern}\n    line: ${v.sample}`,
        )
        .join('')
      throw new Error(
        `notification service must remain agent-agnostic. Found:${report}\n\n` +
          'Fix: push the variability into the per-agent mod (emit it on the ' +
          'event) or the registry — do not add agent-specific code here.',
      )
    }
  })
})
