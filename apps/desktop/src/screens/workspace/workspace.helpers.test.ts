import { describe, expect, test } from 'bun:test'
import { makeTabKey } from './workspace.helpers'

// This test is the companion of the Rust-side pin
// `compose_tab_id_matches_desktop_makeTabKey` in
// `src-tauri/src/projects_cache.rs`. Both tests assert the SAME string
// for the SAME inputs. If either drifts (e.g. someone changes the
// delimiter from ':' to '/'), mobile and desktop stop sharing PTY
// sessions for the "same" tab because the two sides compute different
// PtyMap keys. The failing test surfaces the drift on whichever side
// changed; a matching update to the other side is required to restore
// green CI.
describe('makeTabKey', () => {
  test('composes <projectId>:<tabId> — must match Rust compose_tab_id', () => {
    // Baseline case pinned identically in Rust's
    // compose_tab_id_matches_desktop_makeTabKey.
    expect(makeTabKey('control-center', 'shell-a9e7')).toBe(
      'control-center:shell-a9e7',
    )
    // Edge case with a colon in the raw id.
    expect(makeTabKey('p', 'a:b')).toBe('p:a:b')
  })
})
