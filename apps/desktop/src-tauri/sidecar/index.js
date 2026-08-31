// JSON-RPC over stdio sidecar.
//
// stdout = the JSON-RPC channel (newline-delimited JSON, one message per line).
// stderr = the log channel. Anything mixed onto stdout would corrupt the
// line-delimited protocol the Rust client parses.
//
// Verbs (Rust -> Node):
//   open      {tab_id, cols, rows}            -> {id, ok: true}
//   write     {tab_id, bytes_b64}             (no reply, fire-and-forget)
//   resize    {tab_id, cols, rows}            -> {id, ok: true}
//   serialize {tab_id, scrollback?}           -> {id, ok: true, payload}
//   close     {tab_id}                        -> {id, ok: true}
//
// Bytes are base64 because JSON cannot carry raw binary cleanly.
//
// Dispatch is async because `serialize` must wait for any in-flight `write`s
// to be parsed by xterm before reading the buffer. Lines are processed
// strictly in order via a per-process queue, so observers see the same write
// → serialize ordering they sent.

'use strict'

const readline = require('node:readline')
const { Terminal } = require('@xterm/headless')
const { SerializeAddon } = require('@xterm/addon-serialize')

// Map<tab_id, { term: Terminal, serializer: SerializeAddon }>
const terminals = new Map()

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

function reply(id, body) {
  if (id == null) return
  send({ id, ...body })
}

function openTab({ tab_id, cols, rows }) {
  if (terminals.has(tab_id)) {
    // Replace silently; closing the old one releases its buffers. This makes
    // re-opens (after a respawn) idempotent for the Rust side.
    terminals.get(tab_id).term.dispose()
    terminals.delete(tab_id)
  }
  const term = new Terminal({
    cols,
    rows,
    scrollback: 5000,
    allowProposedApi: true,
  })
  const serializer = new SerializeAddon()
  term.loadAddon(serializer)
  // last_seq: highest seq the Rust hub has enqueued for this tab. Updated
  // by writeBytes; returned by serializeTab so subscribe_remote can tag
  // its snapshot with the exact seq whose bytes are reflected in the
  // payload. `null` is the "no writes seen yet" sentinel — distinct from
  // 0, which is a legitimate first-broadcast seq. The Rust side reads
  // this as `Option<u64>` and initialises new subscribers accordingly.
  terminals.set(tab_id, { term, serializer, last_seq: null })
}

function writeBytes({ tab_id, bytes_b64, seq }) {
  const entry = terminals.get(tab_id)
  if (!entry) return
  // term.write is async-internal — the data joins a parser queue and the
  // visible buffer updates later. Fire-and-forget at this layer is fine
  // because `serialize` flushes the queue before reading.
  entry.term.write(Buffer.from(bytes_b64, 'base64'))
  // Track the seq the Rust hub assigned to this chunk so a subsequent
  // serialize can return it verbatim. Writes without a seq (historic
  // callers, tests) leave the counter untouched.
  if (typeof seq === 'number') entry.last_seq = seq
}

function resizeTab({ tab_id, cols, rows }) {
  const entry = terminals.get(tab_id)
  if (!entry) return
  entry.term.resize(cols, rows)
}

function flushWrites(term) {
  // Empty write with callback resolves after every previously-queued write
  // has been parsed. Standard xterm.js "drain the parser queue" idiom.
  return new Promise((resolve) => term.write('', resolve))
}

async function serializeTab({ tab_id, scrollback }) {
  const entry = terminals.get(tab_id)
  if (!entry) return { ok: false, error: 'no_such_tab' }
  await flushWrites(entry.term)
  const payload = entry.serializer.serialize({
    scrollback: typeof scrollback === 'number' ? scrollback : 1000,
  })
  // last_seq is the highest seq whose bytes have been fully parsed into the
  // terminal buffer (flushWrites above waits for the parser to drain, so
  // every write recorded before flush-callback has been applied). The Rust
  // hub uses this exact value to tag ServerFrame::Snapshot.seq, eliminating
  // the drift-window race between "which write did the payload include" and
  // "which seq will the next Bytes broadcast target".
  return { ok: true, payload, last_seq: entry.last_seq }
}

function closeTab({ tab_id }) {
  const entry = terminals.get(tab_id)
  if (!entry) return
  entry.term.dispose()
  terminals.delete(tab_id)
}

async function dispatch(msg) {
  const { id, verb, args } = msg
  try {
    switch (verb) {
      case 'open':
        openTab(args)
        return reply(id, { ok: true })
      case 'write':
        writeBytes(args)
        return // fire-and-forget
      case 'resize':
        resizeTab(args)
        return reply(id, { ok: true })
      case 'serialize': {
        const result = await serializeTab(args)
        return reply(id, result)
      }
      case 'close':
        closeTab(args)
        return reply(id, { ok: true })
      default:
        return reply(id, { ok: false, error: 'unknown_verb' })
    }
  } catch (err) {
    const message = err?.message ? err.message : String(err)
    reply(id, { ok: false, error: message })
  }
}

// Exported for tests; ignored when run as a process.
module.exports = { dispatch, _terminals: terminals }

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin })

  // Strict-order dispatch queue: every line awaits the previous dispatch
  // before its own runs. Prevents a fast-arriving `write` from being parsed
  // after a subsequent `serialize` flush has already resolved.
  let queue = Promise.resolve()

  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // Malformed input is dropped on purpose: a partial line from a crashed
      // peer should not terminate the sidecar.
      process.stderr.write('[sidecar] dropped non-JSON line\n')
      return
    }
    queue = queue
      .then(() => dispatch(parsed))
      .catch((err) => {
        process.stderr.write(`[sidecar] dispatch error: ${err}\n`)
      })
  })

  rl.on('close', () => {
    // Stdin closed (the Rust side exited or crashed). Release everything and
    // exit cleanly so no headless terminals leak.
    for (const { term } of terminals.values()) term.dispose()
    terminals.clear()
    process.exit(0)
  })

  process.stderr.write('[sidecar] ready\n')
}
