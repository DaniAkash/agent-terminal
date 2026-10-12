import { describe, expect, test } from 'bun:test'
import type { TabSummary } from '@/modules/wss/protocol.gen'
import { cwdBasename, sessionLabel } from './tab-label.helpers'

function tab(partial: Partial<TabSummary>): TabSummary {
  return { tab_id: 'p1:t1', label: 'shell', ...partial } as TabSummary
}

describe('cwdBasename', () => {
  test('matches the desktop helper it mirrors', () => {
    // Same cases the desktop documents on `cwdBasename`. If these drift,
    // the same session reads differently on the two screens.
    expect(cwdBasename('/Users/dani/code/agent-terminal')).toBe(
      '/agent-terminal',
    )
    expect(cwdBasename('/Users/dani')).toBe('/dani')
    expect(cwdBasename('/')).toBe('/')
  })

  test('ignores a trailing slash', () => {
    expect(cwdBasename('/Users/dani/code/')).toBe('/code')
  })

  test('handles a bare segment with no separator', () => {
    expect(cwdBasename('code')).toBe('/code')
  })
})

describe('sessionLabel', () => {
  test('keeps a name the user typed, whatever the directory', () => {
    expect(
      sessionLabel(
        tab({ label: 'my-test-1', user_renamed: true, cwd: '/Users/dani' }),
      ),
    ).toBe('my-test-1')
  })

  test('shows the directory for a session that was never named', () => {
    // The case that motivated this: the desktop showed /control-center
    // while the phone showed "shell 4" for the same session.
    expect(
      sessionLabel(
        tab({ label: 'shell 4', cwd: '/Users/dani/code/control-center' }),
      ),
    ).toBe('/control-center')
  })

  test('prefers the live directory over the persisted one', () => {
    expect(
      sessionLabel(tab({ cwd: '/stale', last_cwd: '/older' }), '/live'),
    ).toBe('/live')
  })

  test('falls back through cwd to last_cwd', () => {
    expect(sessionLabel(tab({ cwd: '/from-cwd', last_cwd: '/older' }))).toBe(
      '/from-cwd',
    )
    expect(sessionLabel(tab({ last_cwd: '/Users/dani/only-stored' }))).toBe(
      '/only-stored',
    )
  })

  test('falls back to the stored label when no directory is known', () => {
    // A tree loaded from disk before the first shell integration event.
    expect(sessionLabel(tab({ label: 'shell 2' }))).toBe('shell 2')
  })

  test('an explicitly renamed session survives having no directory', () => {
    expect(sessionLabel(tab({ label: 'deploy', user_renamed: true }))).toBe(
      'deploy',
    )
  })
})
