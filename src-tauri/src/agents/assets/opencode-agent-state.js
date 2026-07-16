// Agent Terminal opencode plugin.
//
// Reports agent turn state to Agent Terminal's local hook server so the tab
// badge reflects working / blocked / turn-end. Fire-and-forget: it never blocks
// or throws into opencode.
//
// Written by Agent Terminal. Do not edit; reinstalled on launch.
//
// Correlation: `AGENT_TERMINAL_TAB_ID` (and the hook port) are injected into the
// shell by Agent Terminal. When opencode runs outside Agent Terminal the tab id
// is absent and every report is dropped.

const TAB_ID = process.env.AGENT_TERMINAL_TAB_ID
const PORT = process.env.AGENT_TERMINAL_HOOK_PORT || "47384"

// Subagent (task tool) sessions carry a parentID. Only the root session drives
// the pane badge; track child session ids and drop their reports so a subagent
// finishing does not flip the pane to idle while the root is still working.
const childSessions = new Set()

async function report(event, sessionID) {
  if (!TAB_ID) return
  const payload = { agent: "opencode", event, tab_id: TAB_ID }
  // Only send a session id when we actually have one. An empty string would
  // deserialize as a real (but shared) key server-side and could mis-correlate.
  if (sessionID) payload.session_id = sessionID
  const body = JSON.stringify(payload)
  try {
    await fetch(`http://127.0.0.1:${PORT}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(500),
    })
  } catch {
    // one-way notification; ignore transport errors
  }
}

// opencode's session.status carries { type: "idle" | "busy" | "retry" } (older
// builds used a bare string). "idle" means the turn finished.
function stateFromStatus(status) {
  const type = typeof status === "string" ? status : status?.type
  switch (type) {
    case "idle":
      return "turn_end"
    case "busy":
    case "working":
    case "retry":
      return "working"
    default:
      return null
  }
}

// Handlers extracted so the top-level event dispatcher stays flat. Each
// takes the parsed `properties` bag + the current `sessionID`, so the
// dispatcher never has to reach back into `event` for anything.
async function handleSessionCreated(properties, sessionID) {
  if (properties.info?.parentID) {
    childSessions.add(properties.info.id)
  } else if (sessionID) {
    await report("session_start", sessionID)
  }
}

async function handleSessionStatus(properties, sessionID) {
  const state = stateFromStatus(properties.status)
  if (state) await report(state, sessionID)
}

async function dispatchEvent(event) {
  const type = event?.type
  const properties = event?.properties ?? {}
  const sessionID = properties.sessionID
  if (sessionID && childSessions.has(sessionID)) return
  switch (type) {
    case "session.created":
      await handleSessionCreated(properties, sessionID)
      break
    case "session.updated":
    case "session.idle":
    case "session.status":
      await handleSessionStatus(properties, sessionID)
      break
    case "permission.asked":
    case "permission.updated":
      await report("blocked", sessionID)
      break
  }
}

export const AgentTerminalStatePlugin = async () => {
  return {
    "chat.message": async ({ sessionID }) => {
      if (sessionID && childSessions.has(sessionID)) return
      await report("working", sessionID)
    },
    event: async ({ event }) => dispatchEvent(event),
  }
}
