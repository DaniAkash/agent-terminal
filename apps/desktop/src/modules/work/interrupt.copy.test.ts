import { describe, expect, test } from 'bun:test'
import type { ActiveWork } from '@/modules/work/active-work'
import { interruptCopy } from './interrupt.copy'

const work = (over: Partial<ActiveWork> = {}): ActiveWork => ({
  projectId: 'p1',
  projectName: 'control-center',
  tabId: 't1',
  tabLabel: 'release notes',
  reason: 'running',
  detail: 'claude, turn in flight',
  ...over,
})

describe('interruptCopy', () => {
  test('counts the tabs rather than asking an abstract question', () => {
    expect(interruptCopy({ kind: 'quit' }, [work(), work()]).title).toBe(
      'Quit with 2 tabs still working?',
    )
  })

  test('says tab, not tabs, for one', () => {
    expect(interruptCopy({ kind: 'quit' }, [work()]).title).toBe(
      'Quit with 1 tab still working?',
    )
  })

  test('names the tab being closed', () => {
    const copy = interruptCopy(
      { kind: 'close-tab', projectId: 'p1', tabId: 't1' },
      [work({ tabLabel: 'migration' })],
    )
    expect(copy.title).toBe('Close migration?')
    expect(copy.confirm).toBe('Close tab')
  })

  test('explains the real cost when an agent is waiting', () => {
    const copy = interruptCopy(
      { kind: 'close-tab', projectId: 'p1', tabId: 't1' },
      [work({ reason: 'awaiting' })],
    )
    expect(copy.description).toContain('discards the question')
  })

  test('still reads sensibly if the work ended between asking and rendering', () => {
    const copy = interruptCopy(
      { kind: 'close-tab', projectId: 'p1', tabId: 't1' },
      [],
    )
    expect(copy.title).toBe('Close this tab?')
  })

  test('the restart keeps its own wording', () => {
    expect(interruptCopy({ kind: 'restart' }, [work()]).confirm).toBe(
      'Restart anyway',
    )
  })

  test('no copy carries an em dash', () => {
    const all = [
      interruptCopy({ kind: 'quit' }, [work()]),
      interruptCopy({ kind: 'restart' }, [work()]),
      interruptCopy({ kind: 'close-tab', projectId: 'p', tabId: 't' }, [
        work(),
      ]),
    ]
    for (const c of all) {
      expect(`${c.title}${c.description}${c.cancel}${c.confirm}`).not.toContain(
        '—',
      )
    }
  })
})
