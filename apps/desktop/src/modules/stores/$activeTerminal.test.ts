import { mock } from 'bun:test'

// Mock IPC before any store imports — $navigation.ts pulls in $projects
// which in turn touches IPC.saveProjects via persistence side effects.
mock.module('@/modules/ipc/commands', () => ({
  IPC: {
    saveProjects: mock(() => Promise.resolve()),
    closeTab: mock(() => Promise.resolve()),
    openTab: mock(() => Promise.resolve(true)),
    writePty: mock(() => Promise.resolve()),
    resizePty: mock(() => Promise.resolve()),
    listProjects: mock(() => Promise.resolve([])),
    syncProjectsToWss: mock(() => Promise.resolve()),
    reportMobileOpError: mock(() => Promise.resolve()),
    reportMobileOpOk: mock(() => Promise.resolve()),
  },
}))

import { beforeEach, describe, expect, test } from 'bun:test'
import type { XTermHandle } from '@/components/XTermTerminal/XTermTerminal'
import {
  $activeTabKey,
  $terminalHandles,
  getActiveTerminalHandle,
  registerTerminalHandle,
  unregisterTerminalHandle,
} from '@/modules/stores/$activeTerminal'
import { $activeProjectId, $activeTabId } from '@/modules/stores/$navigation'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'

// A handle is identified by reference, never by its method shape — the
// registry uses object identity for race-safe unregistration. Factory
// returns distinct objects with no behaviour; the registry never calls
// any method during these unit tests.
function fakeHandle(): XTermHandle {
  return {
    write: () => {},
    focus: () => {},
    clear: () => {},
    selectAll: () => {},
    searchNext: () => {},
    searchPrevious: () => {},
    sendToPty: () => {},
    pasteToPty: () => {},
  } as XTermHandle
}

beforeEach(() => {
  $terminalHandles.set(new Map())
  $activeProjectId.set('')
  $activeTabId.set({})
})

/* ---------------------------------------------------------------------------
 * $activeTabKey — derived, can't drift from navigation
 * -------------------------------------------------------------------------*/
describe('$activeTabKey', () => {
  test('1: returns null when no project is selected', () => {
    expect($activeTabKey.get()).toBeNull()
  })

  test('2: returns null when project has no active tab in the map', () => {
    $activeProjectId.set('claude-ui')
    expect($activeTabKey.get()).toBeNull()
  })

  test('3: returns null when project key is the empty string', () => {
    // Defensive: $activeProjectId is typed as string and initialises to "".
    // The derived store must treat that as "no selection," not as a real key.
    $activeProjectId.set('')
    $activeTabId.set({ '': 'something' })
    expect($activeTabKey.get()).toBeNull()
  })

  test('4: returns the composite key when both nav stores are set', () => {
    $activeProjectId.set('claude-ui')
    $activeTabId.set({ 'claude-ui': 'dev' })
    expect($activeTabKey.get()).toBe(makeTabKey('claude-ui', 'dev'))
  })

  test('5: re-derives when active project switches without touching the tab map', () => {
    $activeTabId.set({ 'claude-ui': 'dev', 'api-service': 'logs' })
    $activeProjectId.set('claude-ui')
    expect($activeTabKey.get()).toBe('claude-ui:dev')
    $activeProjectId.set('api-service')
    expect($activeTabKey.get()).toBe('api-service:logs')
  })

  test('6: re-derives when active tab switches within the same project', () => {
    $activeProjectId.set('claude-ui')
    $activeTabId.set({ 'claude-ui': 'dev' })
    expect($activeTabKey.get()).toBe('claude-ui:dev')
    $activeTabId.set({ 'claude-ui': 'server' })
    expect($activeTabKey.get()).toBe('claude-ui:server')
  })
})

/* ---------------------------------------------------------------------------
 * registerTerminalHandle / unregisterTerminalHandle
 * -------------------------------------------------------------------------*/
describe('register / unregister', () => {
  test('7: register adds the handle under its tabKey', () => {
    const h = fakeHandle()
    registerTerminalHandle('claude-ui:dev', h)
    expect($terminalHandles.get().get('claude-ui:dev')).toBe(h)
  })

  test('8: register replaces an existing handle for the same key (idempotent on re-register)', () => {
    const h1 = fakeHandle()
    const h2 = fakeHandle()
    registerTerminalHandle('claude-ui:dev', h1)
    registerTerminalHandle('claude-ui:dev', h2)
    expect($terminalHandles.get().get('claude-ui:dev')).toBe(h2)
  })

  test('9: unregister removes the handle when identity matches', () => {
    const h = fakeHandle()
    registerTerminalHandle('claude-ui:dev', h)
    unregisterTerminalHandle('claude-ui:dev', h)
    expect($terminalHandles.get().has('claude-ui:dev')).toBe(false)
  })

  test('10: unregister is a no-op when the slot holds a different handle (race-safe)', () => {
    // Scenario: pane A registers, pane B remounts with the same key and
    // registers BEFORE A's effect cleanup runs. When A's cleanup finally
    // fires, it must NOT wipe B's handle.
    const a = fakeHandle()
    const b = fakeHandle()
    registerTerminalHandle('claude-ui:dev', a)
    registerTerminalHandle('claude-ui:dev', b)
    unregisterTerminalHandle('claude-ui:dev', a) // late cleanup from A
    expect($terminalHandles.get().get('claude-ui:dev')).toBe(b)
  })

  test('11: unregister is a no-op when the key is not in the registry', () => {
    const h = fakeHandle()
    unregisterTerminalHandle('claude-ui:dev', h)
    expect($terminalHandles.get().size).toBe(0)
  })

  test('12: multiple panes can be registered side-by-side', () => {
    const a = fakeHandle()
    const b = fakeHandle()
    registerTerminalHandle('claude-ui:dev', a)
    registerTerminalHandle('api-service:logs', b)
    expect($terminalHandles.get().size).toBe(2)
    expect($terminalHandles.get().get('claude-ui:dev')).toBe(a)
    expect($terminalHandles.get().get('api-service:logs')).toBe(b)
  })

  test('13: TerminalPane lifecycle — deferred register followed by unmount cleanup clears the slot', () => {
    // Mirrors TerminalPane: the mount effect runs before xterm fires
    // onReady, so the handle ref is still null and the effect cannot
    // register anything itself. handleReady registers later. The cleanup,
    // captured at mount, must still unregister whatever was registered
    // when it eventually runs at unmount — or the handle leaks.
    const handleRef: { current: XTermHandle | null } = { current: null }

    // 1. "Mount effect" runs — ref is null, nothing to do, but the
    //    closure captures handleRef for the cleanup.
    const cleanup = () => {
      if (handleRef.current) {
        unregisterTerminalHandle('claude-ui:dev', handleRef.current)
      }
    }

    // 2. "handleReady" arrives — pane installs its handle and registers.
    const h = fakeHandle()
    handleRef.current = h
    registerTerminalHandle('claude-ui:dev', h)
    expect($terminalHandles.get().get('claude-ui:dev')).toBe(h)

    // 3. "Unmount" — cleanup runs, reads the ref's CURRENT value (which
    //    is now `h`), and unregisters.
    cleanup()
    expect($terminalHandles.get().has('claude-ui:dev')).toBe(false)
  })

  test('14: register / unregister swap the map identity so nanostores subscribers fire', () => {
    // Mutating the existing Map in place would not flip the store's
    // shallow-equality check. Each write must produce a new Map.
    const before = $terminalHandles.get()
    registerTerminalHandle('claude-ui:dev', fakeHandle())
    const after = $terminalHandles.get()
    expect(after).not.toBe(before)
  })
})

/* ---------------------------------------------------------------------------
 * getActiveTerminalHandle — composition of navigation + registry
 * -------------------------------------------------------------------------*/
describe('getActiveTerminalHandle()', () => {
  test('15: returns null when no project is selected', () => {
    expect(getActiveTerminalHandle()).toBeNull()
  })

  test('16: returns null when the active tab key has no entry in the registry', () => {
    $activeProjectId.set('claude-ui')
    $activeTabId.set({ 'claude-ui': 'dev' })
    expect(getActiveTerminalHandle()).toBeNull()
  })

  test('17: returns the handle for the active tab key', () => {
    const h = fakeHandle()
    registerTerminalHandle('claude-ui:dev', h)
    $activeProjectId.set('claude-ui')
    $activeTabId.set({ 'claude-ui': 'dev' })
    expect(getActiveTerminalHandle()).toBe(h)
  })

  test('18: switching projects switches the active handle without re-registering panes', () => {
    const aHandle = fakeHandle()
    const bHandle = fakeHandle()
    registerTerminalHandle('claude-ui:dev', aHandle)
    registerTerminalHandle('api-service:logs', bHandle)

    $activeTabId.set({ 'claude-ui': 'dev', 'api-service': 'logs' })
    $activeProjectId.set('claude-ui')
    expect(getActiveTerminalHandle()).toBe(aHandle)

    // Project flip alone — no register/unregister call in between.
    $activeProjectId.set('api-service')
    expect(getActiveTerminalHandle()).toBe(bHandle)

    $activeProjectId.set('claude-ui')
    expect(getActiveTerminalHandle()).toBe(aHandle)
  })

  test('19: switching tabs within the same project switches the active handle without re-registering', () => {
    const devHandle = fakeHandle()
    const serverHandle = fakeHandle()
    registerTerminalHandle('claude-ui:dev', devHandle)
    registerTerminalHandle('claude-ui:server', serverHandle)
    $activeProjectId.set('claude-ui')

    $activeTabId.set({ 'claude-ui': 'dev' })
    expect(getActiveTerminalHandle()).toBe(devHandle)

    $activeTabId.set({ 'claude-ui': 'server' })
    expect(getActiveTerminalHandle()).toBe(serverHandle)
  })

  test('20: returns null after the active pane unregisters, even if the registry still has other handles', () => {
    const aHandle = fakeHandle()
    const bHandle = fakeHandle()
    registerTerminalHandle('claude-ui:dev', aHandle)
    registerTerminalHandle('api-service:logs', bHandle)
    $activeProjectId.set('claude-ui')
    $activeTabId.set({ 'claude-ui': 'dev' })

    unregisterTerminalHandle('claude-ui:dev', aHandle)
    expect(getActiveTerminalHandle()).toBeNull()
    // Sanity: B is still in the registry, just not the active one.
    expect($terminalHandles.get().get('api-service:logs')).toBe(bHandle)
  })

  test('21: returns the new handle after a remount (register → unregister-stale → register again)', () => {
    // Simulates StrictMode dev double-fire: handleReady runs twice, the
    // intervening unregister carries the stale identity, and the final
    // state must be the latest handle.
    const stale = fakeHandle()
    const fresh = fakeHandle()
    registerTerminalHandle('claude-ui:dev', stale)
    registerTerminalHandle('claude-ui:dev', fresh)
    unregisterTerminalHandle('claude-ui:dev', stale) // stale cleanup runs late
    $activeProjectId.set('claude-ui')
    $activeTabId.set({ 'claude-ui': 'dev' })
    expect(getActiveTerminalHandle()).toBe(fresh)
  })
})
