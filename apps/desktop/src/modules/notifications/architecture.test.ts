/**
 * Architecture conformance test for the notification service and the
 * push escalation that hangs off it.
 *
 * The whole point of this module is that it is **agent-agnostic** —
 * adding a new per-agent mod (Gemini, Aider, anything) must work without
 * touching any file under `src/modules/notifications/`, nor any file
 * under `src-tauri/src/push/`. Both resolve display names through the
 * registry and route opaque ids; neither may learn an agent's name. To
 * prevent
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
/** `apps/desktop/src/modules/notifications` -> `apps/desktop/src-tauri/src/push` */
const PUSH_DIR = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'src-tauri',
  'src',
  'push',
)

function listSourceFiles(dir: string, exts = ['.ts', '.tsx']): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      out.push(...listSourceFiles(full, exts))
      continue
    }
    if (!exts.some((e) => entry.endsWith(e))) continue
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

/**
 * Drop a Rust file's inline test module.
 *
 * Rust keeps its unit tests in `#[cfg(test)] mod tests` at the bottom of
 * the same file, and those legitimately use agent ids as fixtures. The
 * TypeScript side gets this for free by skipping `.test.ts` files; this
 * is the equivalent cut, and it is as naive as `stripComments` for the
 * same reason: a `#[cfg(test)]` that is not the last item in the file
 * would over-trim, and no file here is shaped that way.
 */
function stripRustTests(src: string): string {
  const at = src.indexOf('#[cfg(test)]')
  return at === -1 ? src : src.slice(0, at)
}

function violationsInFile(file: string, root = NOTIFICATIONS_DIR): Violation[] {
  const raw = readFileSync(file, 'utf8')
  const code = stripComments(file.endsWith('.rs') ? stripRustTests(raw) : raw)
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
      file: file.replace(root, '<module>'),
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

describe('push escalation — agent-agnosticism guard', () => {
  test('no runtime source file mentions specific agent IDs or lookup tables', () => {
    // The push module hangs off the notification service and inherits
    // its constraint: it carries an opaque `agent_id` through to the
    // phone and resolves display names via the registry, exactly as
    // `notifications.rs` does. A match here means somebody taught the
    // escalation path what an agent is called.
    const files = listSourceFiles(PUSH_DIR, ['.rs'])
    expect(files.length).toBeGreaterThan(0) // sanity

    const violations = files.flatMap((f) => violationsInFile(f, PUSH_DIR))

    if (violations.length > 0) {
      const report = violations
        .map(
          (v) =>
            `\n  ${v.file}\n    matches ${v.pattern}\n    line: ${v.sample}`,
        )
        .join('')
      throw new Error(
        `push escalation must remain agent-agnostic. Found:${report}\n\n` +
          'Fix: resolve the display name through AGENT_HOOK_CONFIGS and ' +
          'pass the agent id through opaquely, as notifications.rs does.',
      )
    }
    expect(violations).toEqual([])
  })
})
