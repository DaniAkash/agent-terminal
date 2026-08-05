// Listener for the `wss:mobile_op` Tauri event fired by the Rust WSS
// server. Every mobile CRUD frame (create_tab, rename_project, etc.)
// lands here; we map each op to the matching `$projects` store action.
//
// Success loop: store action mutates `$projects` → persist() fires both
// saveProjects (disk) AND syncProjectsToWss (Rust cache) → cache
// broadcasts a fresh Projects frame to every connected WSS client
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
  addProject,
  addTab,
  removeProject,
  removeTab,
  renameProject,
  renameTab,
  reorderTabs,
} from '@/modules/stores/$projects'

interface MobileOp {
  op: string
  connection_id: number
  op_id: number
  body: unknown
}

// fallow-ignore-next-line complexity
function applyOp(op: string, body: unknown): void {
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
