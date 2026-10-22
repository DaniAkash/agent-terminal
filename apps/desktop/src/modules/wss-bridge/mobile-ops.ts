// Listener for the `wss:mobile_op` Tauri event fired by the Rust WSS
// server. Every mobile CRUD frame (create_tab, rename_project, etc.)
// lands here; we map each op to the matching `$projects` store action.
//
// Success loop: store action mutates `$projects` → persist() writes disk
// and the projects-sync subscriber pushes the merged tree to the Rust
// cache → cache broadcasts a fresh Projects frame to every WSS client
// including the mobile that sent this op. The sender's pending-ops map
// clears when it sees its own mutation land in the pushed tree.
//
// Failure path: any thrown error (invalid project_id, empty label,
// etc.) is reported back via IPC.reportMobileOpError. Rust routes an
// OpError frame to the correct client via the per-op-id inbox
// registered when the CRUD dispatch fired the Tauri event.

import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { IPC } from '@/modules/ipc/commands'
import {
  $projects,
  addProject,
  addTab,
  removeProject,
  removeTab,
  renameProject,
  renameTab,
  reorderTabs,
  setProjectPinned,
  setTabPinned,
} from '@/modules/stores/$projects'
import { bumpTabRecency } from '@/modules/stores/$tabRecency'
import { makeTabKey } from '@/screens/workspace/workspace.helpers'

interface MobileOp {
  op: string
  connection_id: number
  op_id: number
  body: unknown
}

/**
 * Resolve the `tab_id` a mobile op carries to the id the store keys on.
 *
 * Mobile addresses tabs by `TabSummary.tab_id`, which the Rust side
 * composes as `<project_id>:<raw_id>`, while every `$projects` action
 * keys on the bare `t.id`.
 *
 * Resolution is against the project's actual tabs rather than a blind
 * prefix strip, because the two forms are not distinguishable by shape
 * alone: `StoredTab.id` is an unconstrained string, so an id that itself
 * begins with `<project_id>:` would strip down to a different tab. An
 * exact match therefore wins over the stripped candidate, which makes
 * every form resolve to the tab the client meant. Unmatched ids are
 * returned untouched so the store action behaves as it always has.
 */
export function resolveTabId(
  projectId: string,
  tabId: string,
  knownIds: readonly string[],
): string {
  if (knownIds.includes(tabId)) return tabId
  const prefix = `${projectId}:`
  if (!tabId.startsWith(prefix)) return tabId
  const stripped = tabId.slice(prefix.length)
  return knownIds.includes(stripped) ? stripped : tabId
}

function tabIdsOf(projectId: string): string[] {
  const project = $projects.get().find((p) => p.id === projectId)
  return project ? project.tabs.map((t) => t.id) : []
}

/**
 * Resolve `tab_id` on any op body that carries one.
 *
 * Applied once before the dispatch rather than inside each case. Leaving
 * it to the call sites is what let `rename_tab` and `remove_tab` address a
 * tab that never matched: two of the four tab ops remembered to convert
 * and two did not, and a miss is silent because no store action throws on
 * an id it cannot find. Bodies without both fields pass through untouched.
 */
export function normalizeTabOpBody(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body
  const b = body as { project_id?: unknown; tab_id?: unknown }
  if (typeof b.project_id !== 'string' || typeof b.tab_id !== 'string') {
    return body
  }
  return {
    ...body,
    tab_id: resolveTabId(b.project_id, b.tab_id, tabIdsOf(b.project_id)),
  }
}

// fallow-ignore-next-line complexity
function applyOp(op: string, rawBody: unknown): void {
  const body = normalizeTabOpBody(rawBody)
  switch (op) {
    case 'create_project': {
      const b = body as { name: string; path?: string }
      const project = addProject(b.path)
      // addProject auto-generates the project name ("Project N"); apply
      // the user-supplied name in a second step so the label reflects
      // what mobile typed.
      renameProject(project.id, b.name)
      return
    }
    case 'create_tab': {
      const b = body as {
        project_id: string
        label?: string
        cmd?: string
        cwd?: string
      }
      const tab = addTab(b.project_id, b.cwd)
      if (!tab) throw new Error(`project ${b.project_id} not found`)
      if (b.label) renameTab(b.project_id, tab.id, b.label)
      return
    }
    case 'rename_project': {
      const b = body as { project_id: string; new_name: string }
      renameProject(b.project_id, b.new_name)
      return
    }
    case 'rename_tab': {
      const b = body as {
        project_id: string
        tab_id: string
        new_label: string
      }
      renameTab(b.project_id, b.tab_id, b.new_label)
      return
    }
    case 'remove_project': {
      const b = body as { project_id: string }
      removeProject(b.project_id)
      return
    }
    case 'remove_tab': {
      const b = body as { project_id: string; tab_id: string }
      removeTab(b.project_id, b.tab_id)
      return
    }
    case 'reorder_tabs': {
      const b = body as {
        project_id: string
        old_index: number
        new_index: number
      }
      reorderTabs(b.project_id, b.old_index, b.new_index)
      return
    }
    case 'set_tab_pinned': {
      const b = body as { project_id: string; tab_id: string; pinned: boolean }
      setTabPinned(b.project_id, b.tab_id, b.pinned)
      return
    }
    case 'set_project_pinned': {
      const b = body as { project_id: string; pinned: boolean }
      setProjectPinned(b.project_id, b.pinned)
      return
    }
    case 'bump_recency': {
      const b = body as { project_id: string; tab_id: string }
      bumpTabRecency(makeTabKey(b.project_id, b.tab_id))
      return
    }
    default:
      throw new Error(`unknown mobile op: ${op}`)
  }
}

let unlisten: UnlistenFn | null = null

export async function installMobileOpsListener(): Promise<void> {
  if (unlisten) return
  unlisten = await listen<MobileOp>('wss:mobile_op', (event) => {
    const { op, connection_id, op_id, body } = event.payload
    try {
      applyOp(op, body)
      // Signal success back so the mobile sender's pending Promise
      // resolves. connection_id + op_id keys the reply so multi-client
      // pairing doesn't cross-wire outbox routing.
      IPC.reportMobileOpOk(connection_id, op_id).catch(() => {})
    } catch (err) {
      IPC.reportMobileOpError(connection_id, op_id, String(err)).catch(() => {})
    }
  })
}
