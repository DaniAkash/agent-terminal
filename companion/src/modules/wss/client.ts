import { PinnedWebSocket } from '../../../modules/pinned-websocket'
import { $device } from '@/modules/stores/$device'
import { $session, resetSession } from '@/modules/stores/$session'
import type {
  ClientFrame,
  CreateProjectBody,
  CreateTabBody,
  RemoveProjectBody,
  RemoveTabBody,
  RenameProjectBody,
  RenameTabBody,
  ReorderTabsBody,
  ServerFrame,
  TabStateSummary,
} from '@/modules/wss/protocol.gen'
import { computeBackoffDelay } from './client.helpers'

export type TabHandlers = {
  onSnapshot: (payload: string, seq: number) => void
  onBytes: (b64: string, seq: number) => void
  onResized?: (cols: number, rows: number) => void
  onTabState?: (state: TabStateSummary) => void
}

type TabSubscription = TabHandlers & {
  scrollback: number
  lastSeq: number | null
}

const subscriptions = new Map<string, TabSubscription>()

type ConnectionState = {
  socket: PinnedWebSocket | null
  socketGeneration: number
  url: string | null
  token: string | null
  reconnectAttempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  pongDeadline: number | null
  intentionallyDisconnected: boolean
}

const state: ConnectionState = {
  socket: null,
  socketGeneration: 0,
  url: null,
  token: null,
  reconnectAttempts: 0,
  reconnectTimer: null,
  heartbeatTimer: null,
  pongDeadline: null,
  intentionallyDisconnected: false,
}

const HEARTBEAT_INTERVAL_MS = 15_000
const PONG_TIMEOUT_MS = 30_000

export function connect(url: string, token: string): void {
  // Every connection is TLS-pinned end-to-end. The PinnedWebSocket
  // constructor rejects non-wss:// URLs synchronously so a stale ws://
  // URL from a legacy paired record fails loudly at construction rather
  // than silently downgrading the transport.
  console.log('[wss.client] connect()', {
    url,
    tokenLen: token.length,
  })
  clearTimers()
  state.url = url
  state.token = token
  state.intentionallyDisconnected = false
  state.reconnectAttempts = 0
  openSocket()
}

/**
 * Kick the resolver ladder against a persisted DeviceRecord. Walks
 * `resolveWssCandidates(device)` and probes each with a bounded 2s
 * TCP-level socket-open attempt; on the first success, hands off to
 * `connect(url, device.token)` and returns. On full ladder
 * exhaustion, marks the session as `unreachable` so the UI can
 * surface a retry.
 *
 * Kept separate from `connect()` so the manual-token flow (from
 * `/connect`) can bypass the ladder entirely.
 */
export async function autoConnect(
  device: import('@/modules/stores/$device').DeviceRecord,
): Promise<void> {
  const { resolveWssCandidates } = await import('./resolver')
  const candidates = resolveWssCandidates(device)
  // Log a count + the desktop hint but never the actual candidate
  // URLs. LAN IPs + `.local` names are private network topology
  // that ends up attached to shared bug reports otherwise.
  console.log('[wss.client] autoConnect ladder', {
    rungs: candidates.length,
    hint: device.deviceHint,
  })
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    if (candidate === undefined) continue
    const reachable = await probeSocket(candidate, 2000)
    if (reachable) {
      console.log('[wss.client] autoConnect rung hit', { rung: i + 1 })
      connect(candidate, device.token)
      return
    }
  }
  console.warn('[wss.client] autoConnect: all rungs failed')
  $session.setKey('status', 'unreachable')
  $session.setKey(
    'lastError',
    `Can't find desktop on this network (${device.deviceHint})`,
  )
}

function probeSocket(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      resolve(ok)
    }
    const fingerprint = $device.get().record?.fingerprint
    if (!fingerprint) {
      finish(false)
      return
    }
    let ws: PinnedWebSocket
    try {
      ws = new PinnedWebSocket(url, { fingerprint })
    } catch {
      finish(false)
      return
    }
    const timer = setTimeout(() => {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      finish(false)
    }, timeoutMs)
    ws.onopen = () => {
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      finish(true)
    }
    ws.onerror = () => {
      clearTimeout(timer)
      finish(false)
    }
    ws.onclose = () => {
      clearTimeout(timer)
      finish(false)
    }
  })
}

export function disconnect(): void {
  state.intentionallyDisconnected = true
  clearTimers()
  state.socket?.close()
  state.socket = null
  subscriptions.clear()
  resetSession()
}

export function subscribeToTab(
  tabId: string,
  scrollback: number,
  handlers: TabHandlers,
): void {
  const prior = subscriptions.get(tabId)
  const sub: TabSubscription = {
    ...handlers,
    scrollback,
    lastSeq: prior?.lastSeq ?? null,
  }
  subscriptions.set(tabId, sub)
  if ($session.get().status === 'connected') {
    sendSubscribeOrResume(tabId, sub)
  }
}

export function unsubscribeFromTab(tabId: string): void {
  const had = subscriptions.delete(tabId)
  if (!had) return
  if ($session.get().status === 'connected') {
    send({ op: 'unsubscribe', body: { tab_id: tabId } })
  }
}

export function writeToTab(tabId: string, data: string): void {
  send({ op: 'write', body: { tab_id: tabId, data } })
}

export function resizeTab(tabId: string, cols: number, rows: number): void {
  send({ op: 'resize', body: { tab_id: tabId, cols, rows } })
}

// -------- Phase B: mobile CRUD senders --------
//
// Every sender returns Promise<void>. The server signals success with
// an `op_ok` frame (React reports it via IPC after applying the
// mutation) and failure with `op_error`. Both frames carry the op_id
// so this client can route them back to the right pending promise.
// Callers `await` and `.catch(...)` as with any async call.
//
// op_id is a monotonic per-process counter. Overflow after 2^53 is
// theoretical for a single mobile session; skip the wrap logic.

let nextOpId = 1

interface PendingOp {
  resolve: () => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingOps = new Map<number, PendingOp>()

const OP_TIMEOUT_MS = 10_000

/**
 * Reject every in-flight CRUD op with `err`. Called on any hard close
 * so callers don't sit spinning for the 10-second op timeout when the
 * socket is already gone.
 */
function rejectAllPending(err: Error): void {
  for (const [, pending] of pendingOps) {
    clearTimeout(pending.timer)
    pending.reject(err)
  }
  pendingOps.clear()
}

// Shared pending-op plumbing: register the op_id in the pending map,
// arm the timeout, then send the fully-typed frame. Every caller passes
// a `ClientFrame` built from the generated union — no casts, no escape
// hatches. TypeScript enforces the exact wire shape at each sender's
// construction site; a drifted field is a compile error, not a runtime
// server-close-and-reconnect loop.
function sendPending(opId: number, frame: ClientFrame): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Fast-fail if the socket is closed. `send(frame)` silently no-ops
    // when readyState !== OPEN, which without this check would leave
    // the pending entry armed and the caller waiting the full 10 s
    // timeout for a misleading "timed out" error when the actual state
    // is "not connected".
    if (state.socket?.readyState !== PinnedWebSocket.OPEN) {
      reject(new Error(`${frame.op} failed: not connected`))
      return
    }
    const timer = setTimeout(() => {
      if (pendingOps.has(opId)) {
        pendingOps.delete(opId)
        reject(new Error(`${frame.op} timed out after ${OP_TIMEOUT_MS} ms`))
      }
    }, OP_TIMEOUT_MS)
    pendingOps.set(opId, { resolve, reject, timer })
    send(frame)
  })
}

export function sendCreateProject(body: CreateProjectBody): Promise<void> {
  const op_id = nextOpId++
  const frame: ClientFrame = { op: 'create_project', body: { op_id, body } }
  return sendPending(op_id, frame)
}

export function sendCreateTab(body: CreateTabBody): Promise<void> {
  const op_id = nextOpId++
  const frame: ClientFrame = { op: 'create_tab', body: { op_id, body } }
  return sendPending(op_id, frame)
}

export function sendRenameProject(body: RenameProjectBody): Promise<void> {
  const op_id = nextOpId++
  const frame: ClientFrame = { op: 'rename_project', body: { op_id, body } }
  return sendPending(op_id, frame)
}

export function sendRenameTab(body: RenameTabBody): Promise<void> {
  const op_id = nextOpId++
  const frame: ClientFrame = { op: 'rename_tab', body: { op_id, body } }
  return sendPending(op_id, frame)
}

export function sendRemoveProject(body: RemoveProjectBody): Promise<void> {
  const op_id = nextOpId++
  const frame: ClientFrame = { op: 'remove_project', body: { op_id, body } }
  return sendPending(op_id, frame)
}

export function sendRemoveTab(body: RemoveTabBody): Promise<void> {
  const op_id = nextOpId++
  const frame: ClientFrame = { op: 'remove_tab', body: { op_id, body } }
  return sendPending(op_id, frame)
}

export function sendReorderTabs(body: ReorderTabsBody): Promise<void> {
  const op_id = nextOpId++
  const frame: ClientFrame = { op: 'reorder_tabs', body: { op_id, body } }
  return sendPending(op_id, frame)
}

function sendSubscribeOrResume(tabId: string, sub: TabSubscription): void {
  if (sub.lastSeq !== null) {
    console.log('[wss.client] resume', { tabId, lastSeq: sub.lastSeq })
    send({
      op: 'resume',
      body: {
        tab_id: tabId,
        scrollback: sub.scrollback,
        last_seq: sub.lastSeq,
      },
    })
    return
  }
  console.log('[wss.client] subscribe', { tabId })
  send({
    op: 'subscribe',
    body: { tab_id: tabId, scrollback: sub.scrollback },
  })
}

function send(frame: ClientFrame): void {
  if (state.socket?.readyState !== PinnedWebSocket.OPEN) return
  state.socket.send(JSON.stringify(frame))
}

function openSocket(): void {
  if (!state.url || !state.token) {
    console.warn('[wss.client] openSocket skipped, missing url or token')
    return
  }
  $session.setKey('status', 'connecting')
  console.log('[wss.client] opening WebSocket to', state.url)
  const ws = tryConstructSocket(state.url)
  if (!ws) return
  state.socketGeneration += 1
  const generation = state.socketGeneration
  state.socket = ws
  ws.onopen = () => {
    if (!isCurrentGeneration(generation)) return
    handleOpen()
  }
  ws.onmessage = (event) => {
    if (!isCurrentGeneration(generation)) return
    handleFrame(event.data)
  }
  ws.onclose = (event) => {
    if (!isCurrentGeneration(generation)) return
    forceCloseAndReconnect(event.reason || `socket closed (${event.code})`)
  }
  ws.onerror = (event) => {
    if (!isCurrentGeneration(generation)) return
    // Route through forceCloseAndReconnect so a zombie socket that
    // fires onerror without a matching onclose still tears down.
    // Idempotent via the generation bump inside forceCloseAndReconnect.
    forceCloseAndReconnect(event.message || 'socket error')
  }
}

function isCurrentGeneration(generation: number): boolean {
  return generation === state.socketGeneration
}

function tryConstructSocket(url: string): PinnedWebSocket | null {
  const fingerprint = $device.get().record?.fingerprint
  if (!fingerprint) {
    console.error(
      '[wss.client] openSocket blocked: no paired device fingerprint in $device',
    )
    $session.setKey('status', 'auth_failed')
    $session.setKey('lastError', 'not paired')
    return null
  }
  try {
    return new PinnedWebSocket(url, { fingerprint })
  } catch (err) {
    console.error('[wss.client] PinnedWebSocket constructor threw:', err)
    $session.setKey('status', 'unreachable')
    $session.setKey(
      'lastError',
      err instanceof Error ? err.message : String(err),
    )
    scheduleReconnect()
    return null
  }
}

function handleOpen(): void {
  console.log('[wss.client] socket open, sending auth')
  send({ op: 'auth', body: { token: state.token ?? '' } })
}

/**
 * Single teardown path for every "this socket is dead" signal:
 * onclose from the underlying socket, onerror from an already-half-
 * dead socket, or a synthesised close from lifecycle / probe code
 * that noticed the socket is a zombie. Bumps the generation so any
 * further callbacks from the doomed socket are ignored, rejects
 * in-flight ops so callers fail fast, and schedules a reconnect
 * unless the disconnect was intentional (user unpair, revoke).
 *
 * Idempotent: safe to call more than once; the generation bump makes
 * subsequent callbacks from the same socket no-ops and the pending-op
 * map is emptied on the first call.
 */
function forceCloseAndReconnect(reason: string): void {
  console.log('[wss.client] forceClose:', reason)
  state.socketGeneration += 1
  try {
    state.socket?.close()
  } catch {
    /* best-effort; a truly dead socket may throw */
  }
  state.socket = null
  clearTimers()
  rejectAllPending(new Error(`connection lost: ${reason}`))
  if (state.intentionallyDisconnected) return
  if ($session.get().status !== 'auth_failed') {
    $session.setKey('status', 'unreachable')
    if (reason) $session.setKey('lastError', reason)
  }
  scheduleReconnect()
}

function handleFrame(raw: string): void {
  let frame: ServerFrame
  try {
    frame = JSON.parse(raw) as ServerFrame
  } catch (err) {
    console.error('[wss.client] failed to parse frame:', err, 'raw:', raw)
    return
  }
  console.log('[wss.client] frame', frame.op)
  dispatchFrame(frame)
}

// fallow-ignore-next-line complexity
function dispatchFrame(frame: ServerFrame): void {
  if (frame.op === 'auth_ok') {
    handleAuthOk(frame.body.device_name)
    return
  }
  if (frame.op === 'auth_fail') {
    handleAuthFail(frame.body.reason)
    return
  }
  if (frame.op === 'projects') {
    $session.setKey('projects', frame.body.data)
    return
  }
  if (frame.op === 'snapshot') {
    dispatchSnapshot(frame.body.tab_id, frame.body.seq, frame.body.payload)
    return
  }
  if (frame.op === 'bytes') {
    dispatchBytes(frame.body.tab_id, frame.body.seq, frame.body.data)
    return
  }
  if (frame.op === 'resized') {
    subscriptions
      .get(frame.body.tab_id)
      ?.onResized?.(frame.body.cols, frame.body.rows)
    return
  }
  if (frame.op === 'tab_state') {
    subscriptions.get(frame.body.tab_id)?.onTabState?.(frame.body.state)
    return
  }
  if (frame.op === 'pong') {
    state.pongDeadline = null
    return
  }
  if (frame.op === 'op_error') {
    const pending = pendingOps.get(frame.body.op_id)
    if (pending) {
      clearTimeout(pending.timer)
      pendingOps.delete(frame.body.op_id)
      pending.reject(new Error(frame.body.reason))
    }
    return
  }
  if (frame.op === 'op_ok') {
    const pending = pendingOps.get(frame.body.op_id)
    if (pending) {
      clearTimeout(pending.timer)
      pendingOps.delete(frame.body.op_id)
      pending.resolve()
    }
  }
}

function dispatchSnapshot(tabId: string, seq: number, payload: string): void {
  const sub = subscriptions.get(tabId)
  if (!sub) return
  sub.lastSeq = seq
  sub.onSnapshot(payload, seq)
}

function dispatchBytes(tabId: string, seq: number, b64: string): void {
  const sub = subscriptions.get(tabId)
  if (!sub) return
  sub.lastSeq = seq
  sub.onBytes(b64, seq)
}

function handleAuthOk(deviceName: string): void {
  state.reconnectAttempts = 0
  $session.set({
    status: 'connected',
    deviceName,
    projects: $session.get().projects,
    lastError: null,
    lastConnectedAt: Date.now(),
  })
  // Remember which resolver rung actually worked so the next cold
  // start goes straight to the fast path. Parses out the host+port
  // from the connected URL; import is lazy so the client module has
  // no eager dep on the $device store.
  if (state.url) {
    const parsed = parseWssHostPort(state.url)
    if (parsed) {
      void import('@/modules/stores/$device').then((mod) => {
        void mod.updateLastEndpoint(parsed.host, parsed.port)
      })
    }
  }
  startHeartbeat()
  replayOpenSubscriptions()
}

function parseWssHostPort(url: string): { host: string; port: number } | null {
  try {
    const match = url.match(/^wss?:\/\/([^:/]+):(\d+)\//)
    if (!match) return null
    const host = match[1]
    const portRaw = match[2]
    if (host === undefined || portRaw === undefined) return null
    const port = Number.parseInt(portRaw, 10)
    if (!Number.isFinite(port)) return null
    return { host, port }
  } catch {
    return null
  }
}

function replayOpenSubscriptions(): void {
  for (const [tabId, sub] of subscriptions) {
    sendSubscribeOrResume(tabId, sub)
  }
}

function handleAuthFail(reason: string): void {
  console.warn('[wss.client] auth failed:', reason)
  $session.setKey('status', 'auth_failed')
  $session.setKey('lastError', reason)
  state.intentionallyDisconnected = true
  state.socket?.close()
}

function scheduleReconnect(): void {
  const delay = computeBackoffDelay(state.reconnectAttempts)
  state.reconnectAttempts += 1
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null
    openSocket()
  }, delay)
}

function startHeartbeat(): void {
  clearTimers()
  state.heartbeatTimer = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS)
}

function heartbeatTick(): void {
  if (state.socket?.readyState !== PinnedWebSocket.OPEN) return
  send({ op: 'ping' })
  updatePongDeadline()
}

function updatePongDeadline(): void {
  if (state.pongDeadline === null) {
    state.pongDeadline = Date.now() + PONG_TIMEOUT_MS
    return
  }
  if (Date.now() > state.pongDeadline) {
    state.socket?.close()
  }
}

function clearTimers(): void {
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer)
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer)
  state.reconnectTimer = null
  state.heartbeatTimer = null
  state.pongDeadline = null
}
