// Agent Terminal kilo plugin.
//
// Reports agent turn state to Agent Terminal's local hook server so the tab
// badge reflects working / blocked / turn-end. Fire-and-forget: never blocks
// or throws into kilo.
//
// Written by Agent Terminal. Do not edit; reinstalled on launch.

const TAB_ID = process.env.AGENT_TERMINAL_TAB_ID
const PORT = process.env.AGENT_TERMINAL_HOOK_PORT || "47384"

async function report(event, sessionID) {
  if (!TAB_ID) return
  const payload = { agent: "kilo", event, tab_id: TAB_ID }
  // Only send a session id when known; an empty string would become a shared
  // key server-side.
  if (sessionID) payload.session_id = sessionID
  try {
    await fetch(`http://127.0.0.1:${PORT}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(500),
    })
  } catch {
    // one-way notification; ignore transport errors
  }
}

function stateFromSessionStatus(status) {
  if (typeof status !== "string") return null
  switch (status.toLowerCase()) {
    case "idle":
      return "turn_end"
    case "active":
    case "busy":
    case "pending":
    case "running":
    case "streaming":
    case "working":
      return "working"
    default:
      return null
  }
}

export const AgentTerminalStatePlugin = async () => {
  return {
    "chat.message": async ({ sessionID }) => {
      await report("working", sessionID)
    },
    event: async ({ event }) => {
      const type = event && event.type
      const properties = (event && event.properties) || {}
      const sessionID = properties.sessionID
      switch (type) {
        case "session.created":
        case "session.updated":
          if (sessionID) await report("session_start", sessionID)
          break
        case "session.status": {
          const state = stateFromSessionStatus(properties.status)
          if (state) await report(state, sessionID)
          break
        }
        case "tool.execute.before":
        case "tool.execute.after":
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
        case "session.compacted":
          await report("working", sessionID)
          break
        case "permission.asked":
        case "question.asked":
          await report("blocked", sessionID)
          break
      }
    },
  }
}
