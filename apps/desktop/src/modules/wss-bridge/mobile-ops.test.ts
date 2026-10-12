import { mock } from 'bun:test'

// Mock IPC before any store imports so Tauri invoke() is never called.
mock.module('@/modules/ipc/commands', () => ({
  IPC: {
    saveProjects: mock(() => Promise.resolve()),
    closeTab: mock(() => Promise.resolve()),
    reportMobileOpOk: mock(() => Promise.resolve()),
    reportMobileOpError: mock(() => Promise.resolve()),
  },
}))

// Capture the handler the listener registers so the test can drive the
// real dispatch path rather than a module-private function.
let handler: ((event: { payload: MobileOp }) => void) | null = null
mock.module('@tauri-apps/api/event', () => ({
  listen: mock((_name: string, cb: (event: { payload: MobileOp }) => void) => {
    handler = cb
    return Promise.resolve(() => {})
  }),
}))

import { beforeEach, describe, expect, test } from 'bun:test'
import { $projects } from '@/modules/stores/$projects'
import { $tabRecency, $tabRecencyTimes } from '@/modules/stores/$tabRecency'
import type { Project } from '@/screens/workspace/workspace.types'
import { installMobileOpsListener, normalizeTabOpBody } from './mobile-ops'

interface MobileOp {
  op: string
  connection_id: number
  op_id: number
  body: unknown
}

/** The composed form every mobile client sends, as Rust builds it. */
const WIRE_TAB_ID = 'p1:shell-a3f9'

function seed(): void {
  const projects: Project[] = [
    {
      id: 'p1',
      name: 'browseros',
      path: '/tmp/browseros',
      pinned: false,
      tabs: [
        { id: 'shell-a3f9', label: 'claude', cmd: '', pinned: false },
        { id: 'shell-b1c2', label: 'tests', cmd: '', pinned: false },
      ],
    },
  ]
  $projects.set(projects)
}

function send(op: string, body: unknown): void {
  handler?.({ payload: { op, connection_id: 1, op_id: 1, body } })
}

function tabs() {
  return $projects.get()[0]?.tabs ?? []
}

beforeEach(async () => {
  seed()
  $tabRecency.set([])
  $tabRecencyTimes.set({})
  await installMobileOpsListener()
})

describe('tab ops addressed by the composed wire id', () => {
  test('remove_tab removes the tab the client actually named', () => {
    send('remove_tab', { project_id: 'p1', tab_id: WIRE_TAB_ID })
    expect(tabs().map((t) => t.id)).toEqual(['shell-b1c2'])
  })

  test('rename_tab renames it instead of silently doing nothing', () => {
    send('rename_tab', {
      project_id: 'p1',
      tab_id: WIRE_TAB_ID,
      new_label: 'renamed',
    })
    expect(tabs()[0]?.label).toBe('renamed')
    expect(tabs()[0]?.userRenamed).toBe(true)
  })

  test('set_tab_pinned still works, as it did before', () => {
    send('set_tab_pinned', {
      project_id: 'p1',
      tab_id: WIRE_TAB_ID,
      pinned: true,
    })
    expect(tabs().find((t) => t.id === 'shell-a3f9')?.pinned).toBe(true)
  })

  test('bump_recency keys the MRU entry the way the desktop does', () => {
    send('bump_recency', { project_id: 'p1', tab_id: WIRE_TAB_ID })
    expect($tabRecency.get()[0]).toBe('p1:shell-a3f9')
  })
})

describe('tab ops addressed by the raw id', () => {
  test('a raw id is accepted too, so an older client is not broken', () => {
    send('remove_tab', { project_id: 'p1', tab_id: 'shell-a3f9' })
    expect(tabs().map((t) => t.id)).toEqual(['shell-b1c2'])
  })
})

describe('ops that carry no tab id', () => {
  test('rename_project is untouched by the normalisation', () => {
    send('rename_project', { project_id: 'p1', new_name: 'renamed project' })
    expect($projects.get()[0]?.name).toBe('renamed project')
  })

  test('reorder_tabs still moves by index', () => {
    send('reorder_tabs', { project_id: 'p1', old_index: 0, new_index: 1 })
    expect(tabs().map((t) => t.id)).toEqual(['shell-b1c2', 'shell-a3f9'])
  })
})

describe('normalizeTabOpBody', () => {
  test('strips the project prefix', () => {
    expect(
      normalizeTabOpBody({ project_id: 'p1', tab_id: WIRE_TAB_ID }),
    ).toEqual({ project_id: 'p1', tab_id: 'shell-a3f9' })
  })

  test('is idempotent, so an already-raw id survives', () => {
    const once = normalizeTabOpBody({ project_id: 'p1', tab_id: WIRE_TAB_ID })
    expect(normalizeTabOpBody(once)).toEqual(once)
  })

  test('leaves other fields on the body alone', () => {
    expect(
      normalizeTabOpBody({
        project_id: 'p1',
        tab_id: WIRE_TAB_ID,
        new_label: 'x',
      }),
    ).toEqual({ project_id: 'p1', tab_id: 'shell-a3f9', new_label: 'x' })
  })

  test('only strips the prefix of its own project', () => {
    expect(
      normalizeTabOpBody({ project_id: 'p2', tab_id: WIRE_TAB_ID }),
    ).toEqual({ project_id: 'p2', tab_id: WIRE_TAB_ID })
  })

  test('passes through a body with no tab id', () => {
    const body = { project_id: 'p1', new_name: 'x' }
    expect(normalizeTabOpBody(body)).toBe(body)
  })

  test('passes through anything that is not an object', () => {
    expect(normalizeTabOpBody(null)).toBeNull()
    expect(normalizeTabOpBody('nope')).toBe('nope')
  })
})
