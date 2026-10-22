import { describe, expect, test } from 'bun:test'
import {
  composedTabId,
  rawTabId,
  splitTabId,
  terminalRouteAction,
} from './tab.helpers'

describe('composedTabId', () => {
  test('joins the two route params into the wire identifier', () => {
    expect(composedTabId('p1', 'shell-a3f9')).toBe('p1:shell-a3f9')
  })

  test('is idempotent, so an already composed id is not double prefixed', () => {
    expect(composedTabId('p1', 'p1:shell-a3f9')).toBe('p1:shell-a3f9')
  })

  test('keeps a raw id whose own text contains a colon', () => {
    expect(composedTabId('p1', 'p2:x')).toBe('p1:p2:x')
  })
})

describe('splitTabId', () => {
  test('splits on the first colon, since raw ids may contain more', () => {
    expect(splitTabId('p1:p2:x')).toEqual({ projectId: 'p1', tabId: 'p2:x' })
  })

  test('round-trips with composedTabId', () => {
    const parts = splitTabId('p1:shell-a3f9')
    expect(parts).not.toBeNull()
    expect(composedTabId(parts?.projectId ?? '', parts?.tabId ?? '')).toBe(
      'p1:shell-a3f9',
    )
  })

  test('rejects shapes that cannot address a tab', () => {
    expect(splitTabId('noseparator')).toBeNull()
    expect(splitTabId(':leading')).toBeNull()
    expect(splitTabId('trailing:')).toBeNull()
  })
})

describe('rawTabId', () => {
  test('strips the project prefix the wire composes on', () => {
    expect(rawTabId('p1', 'p1:shell-a3f9')).toBe('shell-a3f9')
  })

  test('leaves an already-raw id alone, so it is safe to apply twice', () => {
    expect(rawTabId('p1', 'shell-a3f9')).toBe('shell-a3f9')
    expect(rawTabId('p1', rawTabId('p1', 'p1:shell-a3f9'))).toBe('shell-a3f9')
  })

  test('only strips its own project, not another one', () => {
    expect(rawTabId('p1', 'p2:shell')).toBe('p2:shell')
  })
})

describe('terminalRouteAction', () => {
  test('renders for a paired device, whatever the connection is doing', () => {
    // The regression this guards: a dropped desktop used to eject the user
    // from the terminal, discarding the scrollback and the queued keys.
    expect(terminalRouteAction({ loaded: true, record: { id: 'd1' } })).toBe(
      'render',
    )
  })

  test('sends an unpaired phone to pairing', () => {
    expect(terminalRouteAction({ loaded: true, record: null })).toBe('pair')
  })

  test('renders while the stored devices are still being read', () => {
    // A flash of the pairing screen on every cold start would be worse
    // than a moment of an empty terminal that is about to fill.
    expect(terminalRouteAction({ loaded: false, record: null })).toBe('render')
  })
})
